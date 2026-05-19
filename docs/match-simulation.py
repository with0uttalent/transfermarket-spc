#!/usr/bin/env python3
"""Generate match simulation documentation PDF."""

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, KeepTogether
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
import os, glob

# ── Font setup ────────────────────────────────────────────────────────────────
def find_font(names):
    paths = ['/usr/share/fonts', '/usr/local/share/fonts', os.path.expanduser('~/.fonts')]
    for base in paths:
        for name in names:
            for f in glob.glob(f'{base}/**/{name}', recursive=True):
                return f
    return None

REGULAR = find_font(['DejaVuSans.ttf', 'LiberationSans-Regular.ttf', 'FreeSans.ttf'])
BOLD    = find_font(['DejaVuSans-Bold.ttf', 'LiberationSans-Bold.ttf', 'FreeSansBold.ttf'])

if REGULAR:
    pdfmetrics.registerFont(TTFont('Doc', REGULAR))
    FONT = 'Doc'
else:
    FONT = 'Helvetica'

if BOLD:
    pdfmetrics.registerFont(TTFont('DocBold', BOLD))
    BFONT = 'DocBold'
else:
    BFONT = 'Helvetica-Bold'

# ── Colour palette ────────────────────────────────────────────────────────────
C_GREEN      = colors.HexColor('#16a34a')
C_GREEN_DARK = colors.HexColor('#14532d')
C_GREEN_LIGHT= colors.HexColor('#dcfce7')
C_SLATE      = colors.HexColor('#1e293b')
C_GRAY_BG    = colors.HexColor('#f1f5f9')
C_GRAY_LINE  = colors.HexColor('#cbd5e1')
C_AMBER      = colors.HexColor('#d97706')
C_WHITE      = colors.white
C_RED_LIGHT  = colors.HexColor('#fee2e2')
C_AMBER_LIGHT= colors.HexColor('#fef3c7')

W, H = A4
MARGIN = 18 * mm

# ── Styles ────────────────────────────────────────────────────────────────────
def S(name, **kw):
    return ParagraphStyle(name, fontName=FONT, **kw)

def SB(name, **kw):
    return ParagraphStyle(name, fontName=BFONT, **kw)

sTitle   = SB('title',   fontSize=22, textColor=C_WHITE,      spaceAfter=2,  leading=28)
sSub     = S('sub',      fontSize=11, textColor=C_GREEN_LIGHT, spaceAfter=0,  leading=14)
sH1      = SB('h1',      fontSize=13, textColor=C_GREEN_DARK,  spaceBefore=8, spaceAfter=4, leading=17)
sH2      = SB('h2',      fontSize=11, textColor=C_SLATE,       spaceBefore=6, spaceAfter=3, leading=15)
sBody    = S('body',     fontSize=9,  textColor=C_SLATE,       spaceAfter=3,  leading=13, alignment=TA_JUSTIFY)
sCode    = ParagraphStyle('code', fontName='Courier', fontSize=8.5,
             textColor=colors.HexColor('#1e3a5f'),
             backColor=colors.HexColor('#e8f4fd'), borderPadding=(4,6,4,6),
             spaceAfter=4, leading=13)
sBullet  = S('bullet',   fontSize=9,  textColor=C_SLATE,       spaceAfter=2,  leading=13,
             leftIndent=12, bulletIndent=0)
sCaption = S('caption',  fontSize=8,  textColor=colors.HexColor('#64748b'), spaceAfter=2, leading=11)
sNote    = S('note',     fontSize=8.5,textColor=colors.HexColor('#92400e'),
             backColor=C_AMBER_LIGHT, borderPadding=(5,8,5,8), spaceAfter=6, leading=12)
sTip     = S('tip',      fontSize=8.5,textColor=C_GREEN_DARK,
             backColor=C_GREEN_LIGHT, borderPadding=(5,8,5,8), spaceAfter=6, leading=12)

# ── Table style helpers ───────────────────────────────────────────────────────
def base_table_style(header_bg=C_GREEN, alt_bg=C_GRAY_BG):
    return TableStyle([
        ('FONTNAME',      (0,0),(-1,0),  BFONT),
        ('FONTNAME',      (0,1),(-1,-1), FONT),
        ('FONTSIZE',      (0,0),(-1,-1), 8.5),
        ('BACKGROUND',    (0,0),(-1,0),  header_bg),
        ('TEXTCOLOR',     (0,0),(-1,0),  C_WHITE),
        ('ROWBACKGROUNDS',(0,1),(-1,-1), [C_WHITE, alt_bg]),
        ('GRID',          (0,0),(-1,-1), 0.4, C_GRAY_LINE),
        ('LEFTPADDING',   (0,0),(-1,-1), 7),
        ('RIGHTPADDING',  (0,0),(-1,-1), 7),
        ('TOPPADDING',    (0,0),(-1,-1), 5),
        ('BOTTOMPADDING', (0,0),(-1,-1), 5),
        ('VALIGN',        (0,0),(-1,-1), 'TOP'),
    ])

# ── Content width ─────────────────────────────────────────────────────────────
CW = W - 2 * MARGIN

# ═════════════════════════════════════════════════════════════════════════════
# BUILD STORY
# ═════════════════════════════════════════════════════════════════════════════
story = []

# ── COVER BLOCK ───────────────────────────────────────────────────────────────
cover_data = [[
    Paragraph('Механика симуляции матча', sTitle),
    Paragraph('Руководство для тренеров — на что влияет стоимость состава и OVR игроков', sSub),
]]
cover = Table(cover_data, colWidths=[CW])
cover.setStyle(TableStyle([
    ('BACKGROUND',   (0,0),(-1,-1), C_GREEN_DARK),
    ('LEFTPADDING',  (0,0),(-1,-1), 16),
    ('RIGHTPADDING', (0,0),(-1,-1), 16),
    ('TOPPADDING',   (0,0),(-1,-1), 18),
    ('BOTTOMPADDING',(0,0),(-1,-1), 18),
    ('ROUNDEDCORNERS', [6]),
]))
story.append(cover)
story.append(Spacer(1, 8*mm))

# ── SECTION 1: Two modes ──────────────────────────────────────────────────────
story.append(Paragraph('1. Два режима расчёта', sH1))
story.append(Paragraph(
    'Движок автоматически выбирает режим перед каждым матчем в зависимости от того, '
    'настроен ли стартовый состав команды:', sBody))
story.append(Spacer(1, 2*mm))

modes = [
    ['Условие', 'Режим', 'Основа расчёта'],
    ['≥ 7 стартеров выставлено в состав', 'OVR-режим', 'Навыки игроков (OVR)'],
    ['< 7 стартеров или состав не настроен', 'Стоимостной режим', 'Рыночная стоимость'],
]
t = Table(modes, colWidths=[CW*0.42, CW*0.27, CW*0.31])
t.setStyle(base_table_style())
story.append(t)
story.append(Spacer(1, 2*mm))
story.append(Paragraph(
    '⚠ <b>Важно:</b> если хотя бы одна команда имеет менее 7 стартеров — '
    'обе команды переходят в стоимостной режим. Всегда выставляй полный состав.', sNote))

# ── SECTION 2: OVR mode ───────────────────────────────────────────────────────
story.append(Paragraph('2. OVR-режим — расчёт по навыкам', sH1))
story.append(Paragraph(
    'Для каждого стартера берутся пять навыков (скорость, удары, пасы, защита, физика) '
    'и считается его вклад в атаку или защиту команды в зависимости от позиции.', sBody))
story.append(Spacer(1, 2*mm))

story.append(Paragraph('Веса навыков по позициям', sH2))

pos_data = [
    ['Позиция', 'Формула вклада игрока', 'Влияет на'],
    ['Нападающий\n(FWD, Winger, AM)',
     'удары×0.40 + скорость×0.30\n+ пасы×0.15 + физика×0.15',
     'Атаку'],
    ['Хавбек\n(CM, DM)',
     'пасы×0.35 + защита×0.25\n+ удары×0.20 + физика×0.20',
     'Атаку и защиту'],
    ['Защитник\n(CB, LB, RB)',
     'защита×0.50 + физика×0.25\n+ скорость×0.15 + пасы×0.10',
     'Защиту'],
    ['Вратарь',
     'защита×0.55 + физика×0.30\n+ пасы×0.15',
     'Защиту'],
]
t = Table(pos_data, colWidths=[CW*0.24, CW*0.50, CW*0.26])
t.setStyle(base_table_style())
t.setStyle(TableStyle([
    ('FONTNAME',      (0,0),(-1,0),  BFONT),
    ('FONTNAME',      (0,1),(-1,-1), FONT),
    ('FONTSIZE',      (0,0),(-1,-1), 8.5),
    ('BACKGROUND',    (0,0),(-1,0),  C_GREEN),
    ('TEXTCOLOR',     (0,0),(-1,0),  C_WHITE),
    ('ROWBACKGROUNDS',(0,1),(-1,-1), [C_WHITE, C_GRAY_BG]),
    ('GRID',          (0,0),(-1,-1), 0.4, C_GRAY_LINE),
    ('LEFTPADDING',   (0,0),(-1,-1), 7),
    ('RIGHTPADDING',  (0,0),(-1,-1), 7),
    ('TOPPADDING',    (0,0),(-1,-1), 5),
    ('BOTTOMPADDING', (0,0),(-1,-1), 5),
    ('VALIGN',        (0,0),(-1,-1), 'TOP'),
    ('FONTNAME',      (1,1),(1,-1),  'Courier'),
    ('FONTSIZE',      (1,1),(1,-1),  8),
]))
story.append(t)
story.append(Spacer(1, 3*mm))

story.append(Paragraph('Итоговые силы команды', sH2))
story.append(Paragraph(
    'Средние вклады по линиям объединяются в две итоговые величины — '
    '<b>Атака</b> и <b>Защита</b>:', sBody))
story.append(Paragraph(
    'Атака  = avg(FWD)×0.55 + avg(MID)×0.30 + avg(DEF)×0.10 + avg(GK)×0.05', sCode))
story.append(Paragraph(
    'Защита = avg(DEF)×0.45 + avg(GK)×0.30 + avg(MID)×0.20 + avg(FWD)×0.05', sCode))
story.append(Spacer(1, 2*mm))

story.append(Paragraph('Штрафы за незакрытые позиции', sH2))
story.append(Paragraph(
    'Если в стартовом составе не хватает игроков на ключевых позициях, '
    'команда получает понижающие коэффициенты:', sBody))

pen_data = [
    ['Ситуация', 'Штраф'],
    ['Нет вратаря', 'Защита ×0.60  (−40%)'],
    ['0 защитников и опорников', 'Защита ×0.55  (−45%)'],
    ['1 защитник или опорник', 'Защита ×0.80  (−20%)'],
    ['Нет нападающих и АМ', 'Атака  ×0.50  (−50%)'],
    ['Менее 2 хавбеков', 'Атака и защита ×0.80  (−20%)'],
]
t = Table(pen_data, colWidths=[CW*0.62, CW*0.38])
t.setStyle(base_table_style(header_bg=colors.HexColor('#dc2626'), alt_bg=C_RED_LIGHT))
story.append(t)

# ── SECTION 3: Value mode ─────────────────────────────────────────────────────
story.append(Spacer(1, 4*mm))
story.append(Paragraph('3. Стоимостной режим', sH1))
story.append(Paragraph(
    'Если состав не настроен, каждый игрок оценивается по рыночной стоимости '
    'через логарифмическую шкалу:', sBody))
story.append(Paragraph('сила_игрока = log₁₀(max(стоимость, 100 000 €))', sCode))
story.append(Spacer(1, 1*mm))

val_data = [
    ['Рыночная стоимость', 'Единиц силы'],
    ['100 000 €',  '5.0'],
    ['500 000 €',  '5.7'],
    ['1 000 000 €','6.0'],
    ['5 000 000 €','6.7'],
    ['10 000 000 €','7.0'],
    ['50 000 000 €','7.7'],
    ['100 000 000 €','8.0'],
]
t = Table(val_data, colWidths=[CW*0.55, CW*0.45])
t.setStyle(base_table_style(header_bg=C_AMBER))
story.append(t)
story.append(Spacer(1, 2*mm))
story.append(Paragraph(
    'Шкала логарифмическая: разница между игроком за 1 млн и за 10 млн — всего 1 единица. '
    'Десятикратный рост стоимости даёт лишь +1 к силе. '
    'Это значит, что команда со многими средними игроками может быть сильнее '
    'команды с одной суперзвездой.', sBody))

# ── SECTION 4: Goal probability ───────────────────────────────────────────────
story.append(Spacer(1, 2*mm))
story.append(Paragraph('4. Вероятность гола', sH1))
story.append(Paragraph(
    'Каждую из 90 минут движок бросает кубик отдельно для каждой команды:', sBody))
story.append(Paragraph(
    'P(гол хозяев) = 0.018 × атака_хозяев / (защита_гостей + 0.5)   [OVR-режим]', sCode))
story.append(Paragraph(
    'P(гол хозяев) = 0.013 × атака_хозяев / (защита_гостей + 4.5)   [стоимостной]', sCode))
story.append(Paragraph(
    'Чем выше атака твоей команды относительно защиты соперника — тем выше шанс гола '
    'в каждую минуту. Решает соотношение сил, а не абсолютные значения.', sBody))
story.append(Spacer(1, 2*mm))
story.append(Paragraph(
    '<b>Красные карточки</b> снижают эффективность: '
    'каждое удаление умножает атаку на ×0.88 и защиту на ×0.85.', sBody))

# ── SECTION 5: Post-match growth ──────────────────────────────────────────────
story.append(Spacer(1, 2*mm))
story.append(Paragraph('5. Развитие игрока после матча', sH1))
story.append(Paragraph(
    'По итогам каждого матча навыки и рыночная стоимость каждого участника меняются '
    'на основе его личной статистики и рейтинга:', sBody))
story.append(Spacer(1, 2*mm))

dev_data = [
    ['Событие', 'Изменение навыков', 'Изменение стоимости'],
    ['Гол',              'удары +1–3, скорость +0–1',          '+3.5–5.5%'],
    ['Ассист',           'пасы +1–2',                          '+1.5–2.5%'],
    ['Дубль',            '—',                                   'доп. +2.5–4%'],
    ['Хет-трик',         '—',                                   'доп. +8–12%'],
    ['Рейтинг ≥ 9.0',   'случайный навык +1–2',               '+3–5%'],
    ['Рейтинг ≥ 8.5',   'случайный навык +1–2',               '+1.5–2.5%'],
    ['Рейтинг < 5.0',   'случайный навык −1',                 '−1.5–2.5%'],
    ['Жёлтая карточка',  'физика −1',                          '−0.5–1%'],
    ['Красная карточка', 'физика −2',                          '−5–8%'],
    ['Травма',           'скорость −1–2, физика −1–2',         '−4–7%'],
]
t = Table(dev_data, colWidths=[CW*0.30, CW*0.42, CW*0.28])
t.setStyle(base_table_style())
story.append(t)
story.append(Spacer(1, 2*mm))

story.append(Paragraph('Дополнительный рост для защитников и вратарей', sH2))
def_data = [
    ['Условие', 'Бонус'],
    ['Сухой матч (команда не пропустила)',  'защита +1–2 (вратарь ещё: физика +0–1)'],
    ['Рейтинг ≥ 7.5',                       'защита +1'],
    ['Каждый матч (25% шанс)',               'физика +1'],
]
t = Table(def_data, colWidths=[CW*0.52, CW*0.48])
t.setStyle(base_table_style(header_bg=colors.HexColor('#1d4ed8')))
story.append(t)

# ── SECTION 6: Practical tips ─────────────────────────────────────────────────
story.append(Spacer(1, 4*mm))
story.append(Paragraph('6. Практические выводы для тренера', sH1))

tips = [
    ('<b>Всегда выставляй состав.</b> С 7+ стартерами матч идёт по OVR-режиму — '
     'это выгоднее для молодых игроков с высоким навыком при скромной цене.'),
    ('<b>Вратарь обязателен.</b> Без него защита теряет 40% эффективности.'),
    ('<b>Нападающий нужен.</b> Без форварда или АМ в составе атака падает на 50%.'),
    ('<b>Скамейка работает.</b> Запасные выходят с 55-й по 82-ю минуту (до 3 замен). '
     'Помечай приоритетных игроков в настройках состава.'),
    ('<b>OVR нападающего</b> сильнее всего зависит от <b>ударов</b> (40%) и '
     '<b>скорости</b> (30%). При покупке форварда смотри именно на эти навыки.'),
    ('<b>OVR защитника</b> — от <b>защиты</b> (50%) и <b>физики</b> (25%).'),
    ('<b>OVR вратаря</b> — от <b>защиты</b> (55%) и <b>физики</b> (30%).'),
    ('<b>Защитники растут на сухих матчах.</b> Играй плотно в обороне — '
     'защита и физика вратаря и защитников растут бесплатно.'),
    ('<b>Рейтинг ≥ 8.5</b> даёт случайный прирост навыка игрока. '
     'Старайся выставлять сильный состав, чтобы игроки получали высокие рейтинги.'),
]

for i, tip in enumerate(tips, 1):
    story.append(Paragraph(f'{i}.  {tip}', sBullet))
    story.append(Spacer(1, 1*mm))

# ── FOOTER NOTE ───────────────────────────────────────────────────────────────
story.append(Spacer(1, 4*mm))
story.append(HRFlowable(width=CW, thickness=0.5, color=C_GRAY_LINE))
story.append(Spacer(1, 2*mm))
story.append(Paragraph(
    'Симуляция содержит элемент случайности — в каждую минуту бросается кубик. '
    'Более сильная команда побеждает чаще, но не всегда. '
    'Красные карточки, травмы и удачный рейтинг матча могут изменить исход.', sCaption))

# ── BUILD PDF ─────────────────────────────────────────────────────────────────
out = os.path.join(os.path.dirname(__file__), 'match-simulation.pdf')
doc = SimpleDocTemplate(
    out, pagesize=A4,
    leftMargin=MARGIN, rightMargin=MARGIN,
    topMargin=MARGIN, bottomMargin=MARGIN,
    title='Механика симуляции матча',
    author='Transfermarket SPC',
)
doc.build(story)
print(f'PDF written to {out}')
