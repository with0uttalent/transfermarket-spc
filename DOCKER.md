# Развёртывание в Docker

Как приложение упаковано в контейнер и как его деплоить/обслуживать на сервере.
Документ описывает то, что реально сделано в проекте — читай вместе с
`Dockerfile`, `docker-compose.yml` и `scripts/docker-deploy.sh`.

---

## Что и зачем

Приложение — Node.js/Express + SQLite (`better-sqlite3`) + рендеринг картинок
(`canvas`). Два последних — нативные модули, компилируются под платформу, поэтому
образ собирается в две стадии.

### Постоянное состояние живёт вне контейнера

Контейнер эфемерный: пересобрал — потерял всё, что внутри. Поэтому база и
загруженные картинки вынесены на том `/data`:

| Что                | Путь в контейнере           | Переопределяется через |
|--------------------|-----------------------------|------------------------|
| SQLite база        | `/data/transfermarket.db`   | `DB_PATH`              |
| Загрузки картинок  | `/data/uploads`             | `UPLOADS_DIR`          |

Том `/data` смонтирован из `./data` на сервере (bind mount) — удобно бэкапить
обычным `cp`/`tar`. Вне Docker переменные не заданы, и код использует прежние
пути (`database/transfermarket.db`, `public/images/uploads`) — обратная
совместимость сохранена.

---

## Dockerfile — построчно

Стоит понимать каждую директиву (см. раздел про DevSecOps ниже).

```dockerfile
FROM node:22-bookworm-slim AS build
```
**Стадия сборки.** Тут ставится тулчейн (`g++`, `make`, `python3`, dev-заголовки
cairo/pango/…) — он нужен, только если для нативных модулей нет готового
prebuild-бинарника. `npm ci --omit=dev` ставит зависимости строго по
`package-lock.json` (воспроизводимо), без dev-зависимостей.

```dockerfile
FROM node:22-bookworm-slim
```
**Финальная стадия.** Начинается с чистого образа — компиляторы сюда НЕ
попадают. Ставятся только рантайм-библиотеки canvas (`libcairo2`, `libpango…`,
шрифты) и `curl` для healthcheck.

```dockerfile
COPY --from=build /app/node_modules ./node_modules
COPY . .
```
Скомпилированные `node_modules` копируются из стадии сборки, затем — код.

```dockerfile
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/transfermarket.db UPLOADS_DIR=/data/uploads
RUN mkdir -p /data && chown -R node:node /data /app
USER node
```
Продакшн-режим, пути состояния на том, и — важно для безопасности —
контейнер работает от **непривилегированного пользователя `node`**, а не root.

```dockerfile
VOLUME /data
EXPOSE 3000
HEALTHCHECK ... CMD curl -fsS http://localhost:3000/api/health || exit 1
CMD ["node", "server.js"]
```
Том для состояния, проброс порта, проверка живости (Docker сам помечает
контейнер `healthy`/`unhealthy`), команда запуска.

**Секретов в образе нет.** `JWT_SECRET` и токены Telegram приходят из `.env`
в рантайме через `docker-compose`, а не вшиваются в слои образа.

---

## docker-compose.yml

```yaml
ports:
  - "127.0.0.1:3000:3000"   # только localhost — наружу через nginx
env_file: [.env]            # секреты из .env, не из образа
volumes:
  - ./data:/data            # база + загрузки, переживают пересборку
restart: unless-stopped     # автоперезапуск при падении/ребуте
```

Порт биндится **только на 127.0.0.1** — снаружи приложение недоступно напрямую,
весь публичный трафик идёт через nginx (TLS, CSP и т.д. — как и было со старой
systemd-службой).

---

## Первичный деплой (с нуля / миграция со старой systemd-службы)

### 0. Предпосылки на сервере
- установлен Docker Engine и `docker compose` (V2-плагин) **или** `docker-compose` (V1);
- пользователь в группе `docker` (иначе нет доступа к сокету):
  ```bash
  sudo usermod -aG docker $USER
  # выйти/зайти по SSH или: newgrp docker
  docker ps   # проверка доступа без sudo
  ```

### 1. Создать `.env` с секретами
```bash
cp .env.example .env
nano .env            # вписать JWT_SECRET и токены Telegram
chmod 600 .env       # секреты — только владельцу
```
`JWT_SECRET` можно сгенерировать: `openssl rand -hex 32`.

### 2. Запустить скрипт деплоя
```bash
./scripts/docker-deploy.sh
```
Скрипт делает всё сам:
1. определяет доступную compose-команду (V2 или V1);
2. проверяет наличие `.env` и `JWT_SECRET`;
3. `git fetch` + `reset --hard` на нужную ветку (не спотыкается о локальные правки);
4. **при первом запуске** переносит существующую базу (вместе с WAL-файлами
   `-wal`/`-shm` — там несброшенные записи!) и загрузки в `./data`, и
   **останавливает + отключает старую `transfermarket.service`**;
5. чинит владельца `./data` под пользователя контейнера (uid 1000);
6. собирает образ, поднимает контейнер, ждёт `healthy`.

### 3. Проверить
```bash
docker-compose ps                              # State: Up (healthy)
curl -fsS http://127.0.0.1:3000/api/health     # {"ok":true}
```
nginx уже проксирует на `127.0.0.1:3000` — менять его конфиг не нужно, порт тот же.

---

## Обычный деплой (обновление)

```bash
cd ~/transfermarket-spc
./scripts/docker-deploy.sh
```
`git pull` + пересборка + перезапуск. Данные в `./data` не трогаются. Пропустить
обновление кода (собрать из текущего чекаута): `./scripts/docker-deploy.sh --no-pull`.

---

## Эксплуатация

```bash
docker-compose logs -f          # логи приложения в реальном времени
docker-compose ps               # статус
docker-compose restart          # перезапуск без пересборки
docker-compose down             # остановить и удалить контейнер (том ./data цел)
docker-compose exec app sh      # шелл внутри контейнера
```

Запустить одноразовый скрипт против рабочей базы (напр. чистку дублей титулов):
```bash
docker-compose exec app node scripts/dedupe-league-titles.js
```

### Бэкап
```bash
# База (безопасно на живой базе — через встроенный механизм SQLite)
docker-compose exec app sh -c 'sqlite3 /data/transfermarket.db ".backup /data/backup.db"'
# Либо просто заархивировать том целиком (лучше при остановленном контейнере)
tar czf backup-$(date +%F).tar.gz data/
```

### Освобождение места
Docker-образы/кэш со временем накапливаются:
```bash
docker system df                 # что сколько занимает
docker image prune -f            # висячие (dangling) образы
docker builder prune -f          # кэш сборки
```

---

## Про безопасность (DevSecOps) — что закрыто и что нет

**✅ Заложено в текущей сборке:**
- запуск от **non-root** (`USER node`);
- порт только на **localhost**, наружу — через reverse-proxy;
- **секреты не в образе** — приходят из `.env` в рантайме;
- **multi-stage** — компиляторы не в финальном образе (меньше поверхность атаки);
- воспроизводимые зависимости (`npm ci` по lock-файлу);
- healthcheck для автодетекта нерабочего состояния.

**⚠️ Что ещё предстоит закрыть (не входит в текущую настройку):**
- `npm ci` сообщает об уязвимостях в зависимостях (в т.ч. critical) —
  разобрать `npm audit`, обновить проблемные пакеты (напр. `multer@1.x` → `2.x`);
- нет **сканирования образа** — стоит добавить Trivy/Grype в пайплайн;
- права на `.env` — держать `600`;
- периодически пересобирать образ ради security-патчей базового Debian;
- логи приложения теперь в Docker (json-file драйвер) — стоит настроить
  ротацию (`max-size`/`max-file` в compose), чтобы они не росли бесконечно.

Эти пункты — зона твоей личной ответственности как DevSecOps: инструмент их за
тебя не решит, и делегировать понимание здесь нельзя.
