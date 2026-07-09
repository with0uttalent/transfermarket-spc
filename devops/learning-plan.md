# План обучения: база под весь DevSecOps-стек

Приоритизированный список книг и ресурсов, разбитый по месяцам и синхронизированный
с `roadmap.md`. Цель — не «прочитать всё», а построить фундамент, чтобы
на каждом этапе понимать **что и почему** происходит.

**Как пользоваться:**
- Тиры приоритета: **★ must** (обязательно) · **◆ strong** (сильно желательно) · **○ optional** (по интересу/справочно).
- Справочные книги (Reference) НЕ читаются от корки до корки — держи под рукой, читай главами под задачу.
- **Правило №1: книга + руки.** Прочёл главу — сразу воспроизвёл на своём стенде. Без практики знания не закрепятся.
- Темп рассчитан на ~1–1.5 часа в день + выходные. Медленнее — растяни, это нормально.

---

## Тир 0 — постоянный фон (весь путь, параллельно)

Держи эти ресурсы открытыми всё время, обращайся по мере надобности:

- ★ **[Wizard Zines](https://wizardzines.com/) (Julia Evans)** — короткие иллюстрированные зины
  по сетям, Linux, debugging, Bash, контейнерам. Лучший способ «понять на пальцах».
- ★ **[Pro Git](https://git-scm.com/book/ru/v2) (Scott Chacon)** — бесплатно, на русском. Git ты
  будешь трогать каждый день. Главы 1–3 — сразу, остальное — по надобности.
- ◆ **[OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/)** — практические памятки по защите.
- ◆ **[roadmap.sh/devops](https://roadmap.sh/devops)** — сверяйся с картой навыков, отмечай прогресс.
- ○ **[The Twelve-Factor App](https://12factor.net/)** — 20 минут чтения, формирует правильное мышление о приложениях.

---

## Месяц 1 — Фундамент: Linux, сеть, Git, мышление DevOps

Без этого всё остальное — карточный домик. Контейнеры и k8s — это абстракции
поверх Linux-примитивов (namespaces, cgroups, сеть). Не поняв низ — не поймёшь верх.

- ★ **«The Linux Command Line» — William Shotts** ([бесплатно](https://linuxcommand.org/tlcl.php)).
  Терминал, права, процессы, пайпы, скрипты. Твой фундамент фундаментов.
- ◆ **«How Linux Works» — Brian Ward** (3-е изд.). Как реально устроена ОС: загрузка,
  процессы, systemd, сеть, диски. Читай главы про процессы/сеть/systemd — прямо про то,
  с чем ты уже столкнулся (systemd-служба, забитый `/var/log`).
- ◆ **«The Phoenix Project» — Gene Kim** (художественная, читается как роман по вечерам).
  Зачем вообще DevOps существует. Лёгкое, но переворачивает мышление.
- ○ Сеть на пальцах: зин **[«How DNS works» / «Networking»](https://wizardzines.com/)** + при желании
  **«Computer Networking: A Top-Down Approach» — Kurose & Ross** (академично, глубоко — как справочник).

**Практика:** подними чистую Linux-VM, живи в терминале, напиши пару bash-скриптов,
разбери свой `docker-deploy.sh` построчно. Настрой git-workflow.

---

## Месяц 2 — Контейнеры вглубь (Docker)

Ты уже собрал образ и compose. Теперь пойми, что под капотом: слои, namespaces,
cgroups, сети, тома — почему именно так, а не «магия».

- ★ **«Docker Deep Dive» — Nigel Poulton** (обновляется ежегодно). Лучшая книга по Docker.
  Образы, слои, реестры, сети, тома, swarm — чётко и с практикой.
- ◆ **«The DevOps Handbook» — Kim, Humble, Debois, Willis** (начни, читай параллельно
  весь месяц-два по вечерам). Практики потока, обратной связи, непрерывного обучения.
- ○ **«Container Security» — Liz Rice** (первые главы — про то, КАК устроены контейнеры
  на уровне ядра). Полноценно вернёшься к ней в Месяце 6, но введение полезно уже сейчас.

**Практика:** пересобери образ transfermarket осознанно (зачем multi-stage, non-root,
слои), поиграй с `docker save/load`, подними локальный registry, разбери `DOCKER.md`.

---

## Месяц 3 — Kubernetes: основы

Самый большой прыжок. Начни с мягкого введения, не ныряй сразу в толстые книги.

- ★ **«The Kubernetes Book» — Nigel Poulton** (обновляется ежегодно). Идеальный старт:
  Pods, Deployments, Services, Ingress, StatefulSets — понятно и по делу.
- ★ **Практический курс:** [KodeKloud «Kubernetes for Beginners» / CKA course](https://kodekloud.com/)
  или бесплатно [killercoda.com](https://killercoda.com/) — руками в браузере.
- ◆ **[Kubernetes官方 Concepts](https://kubernetes.io/docs/concepts/)** — читай параллельно книге,
  раздел за разделом. Официальная дока здесь реально хороша.

**Практика:** твой kubeadm-кластер из гайда. Задеплой transfermarket, поломай и почини
(убей под, посмотри пересоздание, отмасштабируй). Начни трогать Helm.

**Веха:** держи в голове цель — сертификация **CKA**. Не обязательно сдавать, но её
программа = идеальный чеклист «что я должен уметь в k8s».

---

## Месяц 4 — Kubernetes вглубь + Helm + GitOps

Теперь по-взрослому. Эта книга большая — заложи ~6 недель, она стоит того.

- ★ **«Kubernetes in Action» — Marko Lukša** (2-е изд.). **Лучшая** книга по k8s для
  глубокого понимания. Здесь ты поймёшь, ПОЧЕМУ всё устроено так. Читай медленно, с руками.
- ◆ **«GitOps and Kubernetes» — Yuen, Matyushentsev et al.** (Manning). ArgoCD, декларативный
  CD, паттерны. Прямо под твой выбор Jenkins+ArgoCD.
- ○ **[Helm docs](https://helm.sh/docs/) + [Chart Best Practices](https://helm.sh/docs/chart_best_practices/)** — не книга, но обязательно.

**Практика:** оформи приложение Helm-чартом (Фаза 2 карты). Поставь ArgoCD, свяжи с
config-репозиторием, сделай первый GitOps-деплой в staging.

---

## Месяц 5 — CI/CD как дисциплина

Сначала теория (она вечная), потом конкретный Jenkins (инструмент сменяем).

- ★ **«Continuous Delivery» — Jez Humble & David Farley**. Библия CD. Читается тяжеловато,
  но задаёт принципы, которые переживут любой конкретный тул. Основа основ пайплайнов.
- ◆ **[Jenkins Handbook: Pipeline](https://www.jenkins.io/doc/book/pipeline/)** + практика.
  Именно Pipeline as Code (`Jenkinsfile`), а не клики в UI.
- ○ **«Terraform: Up & Running» — Yevgeniy Brikman** — если решишь описывать инфру как код
  (IaC). Не обязательно сейчас, но крайне полезный навык. Хотя бы полистай.

**Практика:** Jenkins на build-стенде, первый `Jenkinsfile`: checkout→build→push в Harbor,
webhook из git. Замкни поток с ArgoCD (Jenkins собрал → закоммитил тег → ArgoCD выкатил).

---

## Месяц 6 — Безопасность приложения (та самая «Sec»)

Ядро твоей специализации. Здесь книги + обязательно **атакующая практика** — нельзя
защищать, не понимая, как ломают.

- ★ **«Securing DevOps» — Julien Vehent** (Manning). Практичнейшая книга прямо про
  встраивание безопасности в пайплайн: тестирование, логирование, детект, реакция. Твоя настольная.
- ★ **[OWASP Top 10](https://owasp.org/www-project-top-ten/)** + **[PortSwigger Web Security Academy](https://portswigger.net/web-security)**
  — бесплатно, интерактивно, лучший в мире тренажёр по веб-уязвимостям. Пройди основные модули руками.
- ◆ **«Web Application Security» — Andrew Hoffman** (O'Reilly). Атака+защита веба системно.
- ○ **[OWASP WSTG](https://owasp.org/www-project-web-security-testing-guide/)** — методология тестирования (справочно).

**Практика:** встрой в `Jenkinsfile` стадии Semgrep, Trivy (SCA), Gitleaks; настрой
quality gate SonarQube; подними OWASP ZAP по staging. **Почини те 13 уязвимостей из
своего `npm audit`** — это твой первый реальный результат как DevSecOps.

---

## Месяц 7 — Безопасность Kubernetes и runtime

Защита кластера и того, что в нём крутится. Цель-веха — **CKS**.

- ★ **«Container Security» — Liz Rice** (целиком). Как устроена изоляция, где дыры, как
  харденить. Обязательна для DevSecOps в контейнерном мире.
- ◆ **«Hacking Kubernetes» — Andrew Martin & Michael Hausenblas** (O'Reilly). Атаки на k8s
  и защита от них — мышление «красной команды» для «синей».
- ◆ **[Kubernetes Security (Rice & Hausenblas)](https://kubernetes-security.info/)** — бесплатный отчёт O'Reilly.
- ◆ **[CIS Kubernetes Benchmark](https://www.cisecurity.org/benchmark/kubernetes)** +
  **[NSA/CISA Kubernetes Hardening Guide](https://media.defense.gov/2022/Aug/29/2003066362/-1/-1/0/CTR_KUBERNETES_HARDENING_GUIDANCE_1.2_20220829.PDF)** (бесплатно).

**Практика:** kube-bench (почини замечания), default-deny NetworkPolicy (Calico),
Pod Security `restricted`, Falco (получи алерт на свой `kubectl exec`), Kyverno-политики.

**Веха:** здесь имеет смысл целиться в **[CKS](https://www.cncf.io/training/certification/cks/)**
предметно — это прямой сертификат твоей специализации.

---

## Месяц 8 — Наблюдаемость и надёжность (SRE)

Мониторинг из твоих требований (Grafana) + культура надёжности.

- ★ **«Prometheus: Up & Running» — Brian Brazil** (O'Reilly). PromQL, экспортеры,
  алертинг, архитектура. Прямо под твой kube-prometheus-stack.
- ★ **[Google SRE Book](https://sre.google/sre-book/table-of-contents/)** (бесплатно). Избранные
  главы: Monitoring, SLI/SLO, Alerting, Postmortems. Что вообще значит «надёжно».
- ◆ **«Observability Engineering» — Majors, Fong-Jones, Miranda** (O'Reilly). Метрики/логи/трейсы,
  современный взгляд на наблюдаемость.
- ○ **[The SRE Workbook](https://sre.google/workbook/table-of-contents/)** (бесплатно) — практическое продолжение.

**Практика:** kube-prometheus-stack, дашборды по нодам/подам, кастомные метрики
приложения (prom-client), алерт в свой Telegram-бот при падении пода.

---

## Месяц 9 — Supply chain, упаковка продукта, консолидация

Финальный слой + сборка всего в продукт заказчику.

- ★ **«Software Supply Chain Security» — Cassie Crossley** (O'Reilly). Как защитить цепочку
  поставки ПО — то, что ты уже трогал (cosign, SBOM, SLSA), но системно.
- ◆ **[SLSA framework](https://slsa.dev/)** + **[Sigstore docs](https://docs.sigstore.dev/)** — уровни зрелости и подпись артефактов.
- ◆ **«Accelerate» — Forsgren, Humble, Kim**. Метрики DORA — как измерять, что твой
  пайплайн реально хорош. Короткая, научно обоснованная, закрывает картину.
- ○ **«The Unicorn Project» — Gene Kim** — сиквел «Феникса», по вечерам, для закрепления мышления.

**Практика:** собери air-gapped Docker-бандл заказчику (Фаза 12), настрой SBOM+cosign
в пайплайне, прогони smoke-тест инсталлера на чистой VM. Посчитай свои DORA-метрики.

---

## Сводная таблица приоритетов

| # | Книга / ресурс | Тир | Тип | Когда |
|---|----------------|-----|-----|-------|
| 1 | The Linux Command Line (Shotts) | ★ | читать | М1 |
| 2 | How Linux Works (Ward) | ◆ | reference | М1 |
| 3 | The Phoenix Project (Kim) | ◆ | вечера | М1 |
| 4 | Pro Git (Chacon) | ★ | reference | М0–1 |
| 5 | Docker Deep Dive (Poulton) | ★ | читать | М2 |
| 6 | The DevOps Handbook | ◆ | вечера | М2–3 |
| 7 | The Kubernetes Book (Poulton) | ★ | читать | М3 |
| 8 | Kubernetes in Action (Lukša) | ★ | читать глубоко | М4 |
| 9 | GitOps and Kubernetes (Manning) | ◆ | читать | М4 |
| 10 | Continuous Delivery (Humble/Farley) | ★ | читать | М5 |
| 11 | Securing DevOps (Vehent) | ★ | читать | М6 |
| 12 | PortSwigger Academy + OWASP Top 10 | ★ | практика | М6 |
| 13 | Container Security (Liz Rice) | ★ | читать | М7 |
| 14 | Hacking Kubernetes (Martin) | ◆ | читать | М7 |
| 15 | Prometheus Up & Running (Brazil) | ★ | читать | М8 |
| 16 | Google SRE Book | ★ | reference (гл.) | М8 |
| 17 | Software Supply Chain Security (Crossley) | ★ | читать | М9 |
| 18 | Accelerate (Forsgren) | ◆ | читать | М9 |

---

## Если совсем сжато — «золотая пятёрка» (когда времени в обрез)

Прочти хотя бы это, чтобы понимать 80% происходящего:
1. **The Linux Command Line** — фундамент.
2. **Docker Deep Dive** — контейнеры.
3. **Kubernetes in Action** — оркестрация (главная книга стека).
4. **Securing DevOps** — безопасность в пайплайне (твоя специализация).
5. **Continuous Delivery** — принципы CI/CD.

---

## Практические платформы (руками важнее, чем читать)

- ★ **[KodeKloud](https://kodekloud.com/)** — лучшие лабы по k8s/Docker/Jenkins/ArgoCD/Terraform.
- ★ **[killercoda.com](https://killercoda.com/)** — бесплатные сценарии в браузере (в т.ч. CKA/CKS).
- ★ **[PortSwigger Academy](https://portswigger.net/web-security)** — веб-уязвимости, бесплатно, топ.
- ◆ **[TryHackMe](https://tryhackme.com/)** — атакующая сторона, DevSecOps-пути.
- ◆ **[KillerShell](https://killer.sh/)** — симуляторы экзаменов CKA/CKS.

## Сертификации как измеримые вехи (не самоцель, но дисциплинируют)

- **CKA** (Certified Kubernetes Administrator) — после Месяца 4.
- **CKS** (Certified Kubernetes Security Specialist) — после Месяца 7, **твоя главная цель**.
- (позже, по желанию) **Terraform Associate**, облачные сертификаты — если пойдёшь в IaC/cloud.

---

## Главный принцип

> Не глотай книги залпом. **Каждую прочитанную главу немедленно воспроизводи на своём
> стенде** — на transfermarket, на своём кластере. Веди git-дневник: что сделал, на чём
> напоролся, как починил. Через 9 месяцев это станет и твоей базой, и портфолио,
> которое покажешь работодателю. Понимание рождается на стыке чтения и рук.
