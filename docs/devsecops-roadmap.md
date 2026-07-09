# DevSecOps-пайплайн: дорожная карта

Полный план построения продового CI/CD-пайплайна с безопасностью «слева направо»
(shift-left), мониторингом и упаковкой продукта в инсталлер для заказчика.

**Главная цель — не «настроить тулы», а понять, зачем каждый слой существует, и
вырасти в DevSecOps-инженера.** Поэтому в каждом разделе есть блок «📚 Учить» со
ссылками. Проходи фазы по порядку — каждая опирается на предыдущую.

Зафиксированные решения:
- Заказчик **без своего k8s** → инсталлер = автономный **air-gapped bundle на k3s**.
- Ресурсы можно нарастить → полный стек, отдельный build-стенд.
- CD через **Jenkins (CI + сканеры) + ArgoCD (GitOps)**.

---

## 0. Ментальная модель: что такое DevSecOps и как выглядит пайплайн

Прежде чем ставить тулы — пойми поток. Классический pipeline «от коммита до прода»:

```
   Разработчик
       │ git push
       ▼
  ┌─────────┐   webhook   ┌──────────────────────────────────────────┐
  │   Git   │────────────▶│              Jenkins (CI)                 │
  │ (Gitea) │             │                                           │
  └─────────┘             │  1. Checkout                              │
       ▲                  │  2. SAST: Semgrep, SonarQube              │
       │ commit           │  3. Secrets: Gitleaks                     │
   манифестов             │  4. SCA (зависимости): Trivy / Grype      │
       │                  │  5. Build образа (Kaniko/Buildah)         │
  ┌─────────┐             │  6. Scan образа: Trivy                    │
  │ Git repo│             │  7. Lint Dockerfile/манифестов:           │
  │ (config)│             │     Hadolint, kube-linter, Checkov        │
  └────┬────┘             │  8. Sign + SBOM: cosign, syft            │
       │                  │  9. Push в registry (Harbor)             │
       │ ArgoCD watch     │ 10. Deploy в staging (helm)              │
       ▼                  │ 11. DAST: OWASP ZAP по staging          │
  ┌─────────┐             │ 12. Commit манифестов в config-repo     │
  │ ArgoCD  │◀────────────└──────────────────────────────────────────┘
  │ (GitOps)│
  └────┬────┘
       │ sync
       ▼
  ┌──────────────────────── Kubernetes ────────────────────────┐
  │  staging ns          prod ns                                │
  │  [app pods]          [app pods]      ┌─────────────────┐    │
  │                                      │  Мониторинг:    │    │
  │  Runtime security:                   │  Prometheus +   │    │
  │  Falco, NetworkPolicy,               │  Grafana +      │    │
  │  Pod Security                        │  exporters      │    │
  └──────────────────────────────────────┴─────────────────┘    │
                                                                 │
  Отдельно: build-стенд собирает air-gapped bundle (k3s+образы) │
  → инсталлер заказчику ───────────────────────────────────────┘
```

Ключевые идеи, которые надо усвоить:
- **Shift-left security** — безопасность на каждом шаге, а не «проверка в конце».
- **Fail the build** — если критическая уязвимость, пайплайн падает, а не деплоит.
- **Everything as Code** — инфраструктура, конфиг, пайплайн, политики — всё в git.
- **GitOps** — желаемое состояние кластера описано в git, ArgoCD его синхронизирует.
- **Immutable artifacts** — собрали образ один раз, тот же образ едет staging→prod.

**📚 Учить:**
- [What is DevSecOps? (Red Hat)](https://www.redhat.com/en/topics/devops/what-is-devsecops)
- [OWASP DevSecOps Guideline](https://owasp.org/www-project-devsecops-guideline/)
- [The DevOps Roadmap (roadmap.sh)](https://roadmap.sh/devops) — визуальная карта навыков
- Книга: *«The Phoenix Project»* (художественная, про суть DevOps) и *«Accelerate»* (метрики DORA)

---

## Архитектура стенда (ревизия под твои цели)

Разделяем **build-инфраструктуру** и **runtime-кластер** — так и правильнее с точки
зрения безопасности (CI-система с доступом к секретам и registry — лакомая цель,
её изолируют от прода).

| Хост | Роль | vCPU | RAM | Диск | Что крутит |
|------|------|------|-----|------|------------|
| k8s-master | control plane | 4 | 8 ГБ | 40 ГБ | API, etcd, ArgoCD |
| k8s-worker1 | worker | 4 | 8 ГБ | 60 ГБ | app (staging+prod), часть мониторинга |
| k8s-worker2 | worker | 4 | 8 ГБ | 60 ГБ | app, Prometheus/Grafana |
| **build-стенд** | CI + registry | 4 | 16 ГБ | 100 ГБ | Jenkins, SonarQube, Harbor, сборка bundle |

Почему так:
- **SonarQube** один хочет ~2–4 ГБ (внутри Elasticsearch), **Harbor** — несколько ГБ,
  **Jenkins** — 1–2 ГБ + агенты. В 4 ГБ это не живёт. Отсюда отдельный стенд 16 ГБ.
- **kube-prometheus-stack** (Prometheus+Grafana+exporters) на кластере — ещё ~2–3 ГБ.
- Build-стенд — это и есть твой «отдельный стенд», с которого собирается инсталлер.

> Если позже захочешь ужать: build-стенд можно оставить, а кластер свести к
> одному узлу (k3s). Но для обучения полноценный kubeadm-кластер полезнее — ты
> увидишь etcd, планировщик, сетевые политики «по-взрослому».

**Снапшоты VMware** делай после каждой крупной фазы — сэкономят часы при поломках.

---

## Фаза 1. Базовый кластер Kubernetes

У тебя уже есть гайд `k8skubeadmvmwaresetup.md` — это Фаза 1. Пройди его до
состояния «3 ноды Ready, тестовый под запускается». Добавь к нему:

1. **Ingress-контроллер** (вместо NodePort из гайда) — точка входа HTTP в кластер:
   ```bash
   kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/baremetal/deploy.yaml
   ```
2. **MetalLB** — раздаёт «внешние» IP сервисам type=LoadBalancer в bare-metal сети
   (в облаке это делает провайдер, у тебя на VMware — MetalLB).
3. **StorageClass** — для stateful-компонентов (база, Prometheus TSDB, Harbor).
   Начни с [local-path-provisioner](https://github.com/rancher/local-path-provisioner)
   (простой), позже посмотри Longhorn (реплицируемый).
4. **CNI обязательно Calico** (не Flannel) — понадобится NetworkPolicy в Фазе 9.

**📚 Учить:**
- [Kubernetes Concepts (офиц. дока)](https://kubernetes.io/docs/concepts/) — читать разделами
- [kubernetes.io/docs/tutorials](https://kubernetes.io/docs/tutorials/kubernetes-basics/) — интерактив
- **[killercoda.com/kubernetes](https://killercoda.com/)** — бесплатные k8s-песочницы в браузере
- **[KodeKloud](https://kodekloud.com/)** — лучшие практические курсы по k8s/DevOps (платно, но золото)
- Сертификация как цель: **CKA** (Certified Kubernetes Administrator) → потом **CKS** (Security)
- [Ingress-NGINX](https://kubernetes.github.io/ingress-nginx/) · [MetalLB](https://metallb.universe.tf/)

**Контрольная точка:** `kubectl get nodes` — 3 Ready; Ingress отвечает; PVC создаётся.

---

## Фаза 2. Приложение как Helm-чарт

Сейчас приложение живёт в `docker-compose`. Для k8s его надо описать манифестами,
а лучше сразу **Helm-чартом** — это шаблонизируемый пакет, из которого потом
соберётся и staging, и prod, и инсталлер заказчику.

Что сделать:
1. Установить Helm, создать чарт: `helm create transfermarket`.
2. Перенести в него то, что уже есть в Dockerfile/compose:
   - `Deployment` (образ, порты, env из `DOCKER.md`);
   - `Service` + `Ingress`;
   - `PersistentVolumeClaim` для `/data` (база + загрузки — сейчас это bind-mount);
   - `Secret` для `JWT_SECRET`/токенов (пока просто, в Фазе 10 — SealedSecrets);
   - `values.yaml` — вынести туда образ/тег/домен/ресурсы (параметризация).
3. Прокинуть `securityContext` (runAsNonRoot и т.д. — у тебя уже есть в образе).
4. Добавить `livenessProbe`/`readinessProbe` на `/api/health` (эндпоинт уже есть).

> ⚠️ Нюанс твоего приложения: **SQLite + несколько реплик несовместимы**. SQLite —
> файловая БД на одном томе, две реплики его побьют. Варианты: (а) `replicas: 1` +
> `strategy: Recreate` для начала; (б) со временем миграция на Postgres — это отдельная
> хорошая учебная задача (StatefulSet, PVC, бэкапы). Для пайплайна начни с (а).

**📚 Учить:**
- [Helm docs](https://helm.sh/docs/) · [Chart Best Practices](https://helm.sh/docs/chart_best_practices/)
- [Kubernetes: Configure Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)
- [12-Factor App](https://12factor.net/) — почему конфиг в env, а состояние снаружи

**Контрольная точка:** `helm install` поднимает приложение в namespace `staging`,
оно доступно через Ingress.

---

## Фаза 3. Registry образов (Harbor)

Кластеру нужен доступ к образам. Публичный Docker Hub не годится для прода/приватки —
ставим **Harbor** (open-source registry с встроенным сканированием Trivy, подписью,
RBAC). Живёт на build-стенде.

Что даёт Harbor для DevSecOps:
- приватное хранилище образов с аутентификацией;
- **автосканирование** каждого запушенного образа на уязвимости (Trivy внутри);
- **политики**: запретить деплой образов с critical CVE;
- **подпись образов** (Notation/cosign) — гарантия, что образ не подменили;
- хранение **Helm-чартов** (OCI) и SBOM.

**📚 Учить:**
- [Harbor docs](https://goharbor.io/docs/) · [Harbor: Vulnerability Scanning](https://goharbor.io/docs/latest/administration/vulnerability-scanning/)
- Концепция: [Container image security (Sysdig blog)](https://sysdig.com/learn-cloud-native/container-security/)

**Контрольная точка:** `docker push harbor.local/transfermarket/app:tag` проходит,
Harbor показывает отчёт сканирования по образу.

---

## Фаза 4. CI-оркестратор (Jenkins)

Ставим **Jenkins** на build-стенд — он дирижирует всем пайплайном. Изучи именно
**Pipeline as Code**: весь процесс описывается в `Jenkinsfile` в репозитории, а не
кликами в UI (это и есть «everything as code»).

Что настроить:
1. Jenkins + необходимые плагины (Pipeline, Git, Credentials, Blue Ocean для наглядности).
2. **Агенты в Kubernetes** (Jenkins Kubernetes plugin) — сборочные шаги бегут в
   эфемерных подах кластера, а не на самом Jenkins. Чисто и масштабируемо.
3. Первый `Jenkinsfile`: пока просто checkout → build → push в Harbor.
4. **Webhook** из Gitea: push в репозиторий запускает пайплайн автоматически.
5. Credentials store — секреты (доступ к Harbor, kubeconfig) в Jenkins Credentials,
   НЕ в коде.

> Почему Jenkins, а не GitHub Actions: ты учишься собирать пайплайн «руками» на
> своей инфре, без привязки к облаку. Это ценный навык. Позже посмотри и
> альтернативы (Gitea Actions, GitLab CI) — принципы те же.

**📚 Учить:**
- [Jenkins Handbook: Pipeline](https://www.jenkins.io/doc/book/pipeline/)
- [Jenkinsfile syntax](https://www.jenkins.io/doc/book/pipeline/syntax/)
- [Jenkins Kubernetes plugin](https://plugins.jenkins.io/kubernetes/)
- Практика: [Jenkins на KodeKloud / killercoda](https://killercoda.com/)

**Контрольная точка:** push в git → Jenkins сам собрал образ и запушил в Harbor.

---

## Фаза 5. SAST и проверки кода (shift-left, «S» в DevSecOps)

Теперь в `Jenkinsfile` добавляем стадии безопасности **до сборки**. Всё open-source.
Каждый инструмент закрывает свой класс проблем — не заменяют друг друга:

| Слой | Инструмент | Что ловит |
|------|-----------|-----------|
| **SAST** (код) | [Semgrep](https://semgrep.dev/) | Уязвимые паттерны в JS/Node (инъекции, небезоп. eval и т.п.) |
| **SAST** (глубже) | [SonarQube](https://www.sonarsource.com/products/sonarqube/) | Качество + баги + security hotspots, история, quality gate |
| **Секреты** | [Gitleaks](https://github.com/gitleaks/gitleaks) | Токены/пароли, случайно попавшие в код/историю |
| **SCA** (зависимости) | [Trivy](https://trivy.dev/) / [Grype](https://github.com/anchore/grype) | Уязвимые npm-пакеты (у тебя их уже 13 из `npm audit`!) |
| **Dockerfile** | [Hadolint](https://github.com/hadolint/hadolint) | Плохие практики в Dockerfile |
| **K8s-манифесты** | [kube-linter](https://docs.kubelinter.io/) / [Checkov](https://www.checkov.io/) / [kubesec](https://kubesec.io/) | Небезопасные настройки подов/чартов |

Практика:
1. Добавь стадии в `Jenkinsfile`, каждая падает при находках выше порога (`fail the build`).
2. Начни «мягко» (warn), потом ужесточай до `fail` — иначе застрянешь на старте.
3. **Первое реальное дело:** прогони Trivy по своим зависимостям и почини те самые
   critical (`multer@1.x` → `2.x` и пр.) — это уже настоящая работа DevSecOps.
4. SonarQube quality gate — свяжи с Jenkins, чтобы плохой код не проходил.

**📚 Учить:**
- [OWASP Top 10](https://owasp.org/www-project-top-ten/) — must-know классы уязвимостей
- [Semgrep Registry](https://semgrep.dev/explore) · [Trivy docs](https://aquasecurity.github.io/trivy/)
- [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/) — практ. рекомендации по защите
- **[TryHackMe](https://tryhackme.com/)** / **[PortSwigger Web Security Academy](https://portswigger.net/web-security)** — понять атаки, чтобы понимать защиту (бесплатно, топ)

**Контрольная точка:** пайплайн падает на заведомо уязвимом коде/зависимости и
проходит после фикса.

---

## Фаза 6. Безопасная сборка образа + supply chain

Усиливаем шаг сборки:
1. **Сборка без Docker-демона** в кластере: [Kaniko](https://github.com/GoogleContainerTools/kaniko)
   или [Buildah](https://buildah.io/) — безопаснее, чем docker-in-docker (не нужен
   привилегированный сокет).
2. **Скан собранного образа** Trivy → fail при critical.
3. **SBOM** (Software Bill of Materials): [Syft](https://github.com/anchore/syft) —
   список всего, что внутри образа. Требование зрелых supply-chain практик.
4. **Подпись образа**: [cosign](https://github.com/sigstore/cosign) (Sigstore) —
   подписываешь образ, кластер проверяет подпись перед запуском (Фаза 9).

Это всё про **supply chain security** — защиту цепочки поставки ПО (после атак
типа SolarWinds стало обязательным в enterprise).

**📚 Учить:**
- [SLSA framework](https://slsa.dev/) — уровни зрелости supply chain
- [Sigstore / cosign](https://docs.sigstore.dev/)
- [CNCF Software Supply Chain Best Practices](https://github.com/cncf/tag-security/blob/main/supply-chain-security/supply-chain-security-paper/CNCF_SSCP_v1.pdf)

**Контрольная точка:** в Harbor лежит подписанный образ с прикреплённым SBOM,
пайплайн падает при critical CVE в образе.

---

## Фаза 7. CD через GitOps (ArgoCD)

CI закончился в Harbor. Теперь **доставка в кластер по GitOps**:

Как это работает:
1. Заводишь отдельный **config-репозиторий** — там Helm-чарт/манифесты с тегами образов.
2. **ArgoCD** ставится в кластер и «наблюдает» этот репозиторий.
3. Jenkins после успешной сборки **коммитит новый тег образа** в config-репозиторий.
4. ArgoCD видит изменение и **синхронизирует** кластер под новое состояние.
5. Git = единственный источник правды. Откат = `git revert`. Аудит = история git.

Разделение ответственности: **Jenkins собирает и проверяет, ArgoCD деплоит.**
Это и есть современный промышленный стандарт, который ты выбрал.

Настрой окружения: `staging` (авто-синк при каждом билде) и `prod` (синк вручную/по
approve — учишься gated-деплоям).

**📚 Учить:**
- [Argo CD docs](https://argo-cd.readthedocs.io/) · [Getting Started](https://argo-cd.readthedocs.io/en/stable/getting_started/)
- [OpenGitOps principles](https://opengitops.dev/) — 4 принципа GitOps
- [GitOps with Argo (KodeKloud/ArgoProject на YouTube)](https://www.youtube.com/@ArgoProject)
- Концепция «App of Apps» в ArgoCD

**Контрольная точка:** push кода → Jenkins собрал/проверил → закоммитил тег →
ArgoCD выкатил в staging автоматически; в prod — по ручному approve.

---

## Фаза 8. DAST (динамическое тестирование на живом стенде)

SAST смотрит код, **DAST атакует запущенное приложение**. После деплоя в staging
Jenkins запускает сканер по URL:

- **[OWASP ZAP](https://www.zaproxy.org/)** — эталонный open-source DAST. Режим
  baseline scan в CI: краулит staging, ищет XSS, инъекции, отсутствие security-хедеров и т.п.
- Запускается как стадия пайплайна после деплоя в staging, отчёт — артефактом Jenkins.
- Позже: авторизованное сканирование (с сессией залогиненного пользователя).

**📚 Учить:**
- [OWASP ZAP Getting Started](https://www.zaproxy.org/getting-started/)
- [ZAP Automation in CI/CD](https://www.zaproxy.org/docs/automate/)
- [OWASP WSTG](https://owasp.org/www-project-web-security-testing-guide/) — методология веб-тестирования

**Контрольная точка:** ZAP гоняется по staging автоматически, отчёт доступен в Jenkins,
критичные находки роняют пайплайн.

---

## Фаза 9. Runtime-безопасность и hardening кластера

Защита того, что уже крутится (твой мостик из `k8skubeadmvmwaresetup.md` ведёт сюда):

1. **Pod Security Admission** — навесить уровень `restricted` на namespace приложения.
2. **NetworkPolicy** (нужен Calico) — default-deny, разрешать только нужный трафик
   между подами. По умолчанию в k8s всё общается со всем — это плохо.
3. **[kube-bench](https://github.com/aquasecurity/kube-bench)** — аудит control plane
   по **CIS Kubernetes Benchmark**. Прогони, почини замечания.
4. **[Falco](https://falco.org/)** — runtime-детект аномалий (шелл в контейнере,
   неожиданный сетевой коннект, доступ к чувствительным файлам). CNCF-проект.
5. **[Trivy Operator](https://aquasecurity.github.io/trivy-operator/)** — непрерывный
   скан того, что уже запущено в кластере.
6. **RBAC** — минимальные права сервис-аккаунтам (в т.ч. Jenkins/ArgoCD).
7. **Admission control**: [Kyverno](https://kyverno.io/) или OPA/Gatekeeper — политики
   «не запускать неподписанные образы / без limits / от root».

**📚 Учить:**
- [Kubernetes Security (офиц.)](https://kubernetes.io/docs/concepts/security/)
- [CIS Kubernetes Benchmark](https://www.cisecurity.org/benchmark/kubernetes)
- [Falco docs](https://falco.org/docs/) · [Kyverno policies](https://kyverno.io/policies/)
- **Сертификация: [CKS](https://www.cncf.io/training/certification/cks/)** — прямо твоя цель как DevSecOps
- [NSA/CISA Kubernetes Hardening Guide](https://media.defense.gov/2022/Aug/29/2003066362/-1/-1/0/CTR_KUBERNETES_HARDENING_GUIDANCE_1.2_20220829.PDF)

**Контрольная точка:** kube-bench без critical-замечаний; default-deny NetworkPolicy;
Falco шлёт алерт, когда ты руками делаешь `kubectl exec` в под.

---

## Фаза 10. Управление секретами

`JWT_SECRET` и токены не должны лежать в git открыто. Варианты по возрастанию сложности:
1. **[Sealed Secrets](https://github.com/bitnami-labs/sealed-secrets)** (Bitnami) —
   шифруешь секрет, коммитишь зашифрованным в git, контроллер расшифровывает в кластере.
   Идеально ложится в GitOps. **Начни с этого.**
2. **[HashiCorp Vault](https://www.vaultproject.io/)** — полноценное хранилище секретов
   с динамическими креды, ротацией, аудитом. Более взросло, сложнее. Отдельная большая тема.
3. **[External Secrets Operator](https://external-secrets.io/)** — мост между Vault/облаком и k8s.

**📚 Учить:**
- [Sealed Secrets README](https://github.com/bitnami-labs/sealed-secrets)
- [Vault Tutorials](https://developer.hashicorp.com/vault/tutorials)
- [Kubernetes Secrets (почему base64 ≠ шифрование)](https://kubernetes.io/docs/concepts/configuration/secret/)

**Контрольная точка:** в config-репозитории нет ни одного секрета в открытом виде,
приложение при этом стартует.

---

## Фаза 11. Мониторинг и наблюдаемость (Prometheus + Grafana)

Твоё требование «Grafana мониторит ресурсы всего кластера и контейнеров в подах».
Стандарт де-факто — **kube-prometheus-stack** (Helm-чарт, ставит всё сразу):

- **Prometheus** — сбор метрик (TSDB).
- **node-exporter** — метрики хостов (CPU/RAM/диск нод).
- **kube-state-metrics** — состояние объектов k8s (поды, деплойменты, рестарты).
- **cAdvisor** (в kubelet) — метрики ресурсов каждого контейнера в подах.
- **Grafana** — дашборды (идут готовые: Cluster, Node, Pod/Namespace resources).
- **Alertmanager** — алерты (под упал, нода без памяти, диск кончается — привет `/var/log` 😄).

Что сделать:
1. `helm install kube-prometheus-stack`.
2. Открыть Grafana через Ingress, посмотреть готовые дашборды.
3. Прикрутить метрики самого приложения: Node.js отдаёт `/metrics` через
   [prom-client](https://github.com/siimon/prom-client) → Prometheus их собирает
   (ServiceMonitor) → рисуешь свой дашборд (RPS, латентность, ошибки).
4. Настроить пару алертов в Alertmanager (например в Telegram — у тебя уже есть бот).
5. Позже — логи: **Loki + Promtail** (тот же Grafana, но для логов), трейсы — Tempo.
   «Три столпа наблюдаемости»: метрики / логи / трейсы.

**📚 Учить:**
- [Prometheus docs](https://prometheus.io/docs/introduction/overview/) · [kube-prometheus-stack](https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack)
- [Grafana Fundamentals (Grafana Labs)](https://grafana.com/tutorials/)
- [Google SRE Book](https://sre.google/sre-book/table-of-contents/) — что такое SLI/SLO, «золотые сигналы»
- [PromQL basics](https://prometheus.io/docs/prometheus/latest/querying/basics/)

**Контрольная точка:** в Grafana видно CPU/RAM по нодам, по подам приложения и
кастомные метрики приложения; приходит алерт при падении пода.

---

## Фаза 12. Упаковка инсталлера для заказчика (air-gapped bundle на k3s)

Твоя цель-продукт: заказчик **без своего k8s** ставит приложение «одной командой».
Решение — автономный офлайн-бандл на базе **k3s** (лёгкий Kubernetes в один бинарник).

Идея инсталлера (собирается на build-стенде, в идеале — тоже стадией Jenkins):

```
transfermarket-installer/
├── install.sh              # один вход: ставит k3s, грузит образы, деплоит чарт
├── k3s                     # бинарник k3s (офлайн)
├── k3s-airgap-images.tar   # образы самого k3s
├── images/
│   └── transfermarket.tar  # твои образы (docker save)
├── chart/                  # Helm-чарт приложения
└── values-prod.yaml        # дефолтные значения для заказчика
```

Что делает `install.sh` у заказчика:
1. ставит k3s в air-gap режиме (из локальных файлов, без интернета);
2. импортирует образы в containerd k3s (`ctr images import`);
3. `helm install` твоего чарта;
4. выводит URL, где открылось приложение.

Почему k3s, а не kubeadm: один бинарник, встроенные ingress(traefik)/storage,
запускается на скромной VM — идеально «завернуть» для клиента. При этом снаружи
это тот же Kubernetes, твой Helm-чарт едет без изменений.

Изучи **k3s air-gap install** — это готовый механизм, не надо изобретать:

**📚 Учить:**
- [k3s Air-Gap Install (офиц.)](https://docs.k3s.io/installation/airgap)
- [k3s docs](https://docs.k3s.io/)
- [Helm package & OCI](https://helm.sh/docs/topics/registries/)
- Продвинуто (как это делают в индустрии): [Replicated KOTS](https://kots.io/),
  [Embedded Cluster](https://docs.replicated.com/vendor/embedded-overview) — посмотреть,
  как заворачивают k8s-приложения в инсталлеры для заказчиков (можно вдохновиться).

**Контрольная точка:** на чистой Ubuntu-VM (без интернета) `sudo ./install.sh` за
несколько минут поднимает рабочее приложение. Это и есть твой «продукт заказчику».

---

## Порядок прохождения и на чём не застрять

Не пытайся поднять всё сразу — соберёшь «зоопарк», который не понимаешь. Порядок:

1. **Фазы 1–2** — кластер + приложение в нём через Helm (руками, без CI). Фундамент.
2. **Фазы 3–4** — Harbor + Jenkins, простейший build→push. Появился автопайплайн.
3. **Фаза 5** — навесить SAST/SCA/секреты. Первая реальная польза для безопасности.
4. **Фаза 7** — ArgoCD, GitOps-деплой в staging. Теперь поток «коммит→прод» замкнут.
5. **Фазы 6, 8** — supply chain + DAST. Углубление безопасности.
6. **Фаза 11** — мониторинг (можно и раньше — помогает отлаживать всё остальное).
7. **Фазы 9–10** — hardening + секреты. Приведение в «продовый» вид.
8. **Фаза 12** — упаковка инсталлера. Финальный продукт.

Совет: **веди свой git-репозиторий-дневник** (или Notion) — на каждую фазу пиши, что
сделал, на что напоролся, как починил. Это и закрепляет знания, и станет твоим
портфолио, когда будешь искать позицию DevSecOps.

---

## Общие ресурсы для роста в DevSecOps

**Дорожные карты и обзоры**
- [roadmap.sh/devops](https://roadmap.sh/devops) · [roadmap.sh/cyber-security](https://roadmap.sh/cyber-security)
- [CNCF Landscape](https://landscape.cncf.io/) — карта всех cloud-native инструментов

**Практика (руками, бесплатно/дёшево)**
- [KillerCoda](https://killercoda.com/) — песочницы по k8s/DevOps в браузере
- [KodeKloud](https://kodekloud.com/) — лучшие практические лабы (k8s, Jenkins, ArgoCD, Terraform)
- [TryHackMe](https://tryhackme.com/) · [PortSwigger Academy](https://portswigger.net/web-security) — атакующая сторона (нужно понимать защиту)

**Сертификации как измеримые вехи**
- **CKA** → **CKS** (Kubernetes админ → безопасность) — прямо по твоей цели
- (позже) **AWS/аналог**, **HashiCorp Terraform Associate** — если пойдёшь в IaC/облако

**Каналы/чтение**
- [Google SRE Books](https://sre.google/books/) — бесплатно, фундамент надёжности
- YouTube: TechWorld with Nana (вводные), ArgoProject, CNCF, Aqua Security
- Книги: *«Kubernetes in Action»*, *«Container Security» (Liz Rice)*, *«The DevOps Handbook»*

---

## Что дальше конкретно сейчас

Ближайший разумный шаг — **не строить весь стек, а замкнуть минимальный сквозной
поток** на 1–2 нодах:

> `git push` → Jenkins собирает образ → Trivy сканирует → push в Harbor → ArgoCD
> катит в staging. Даже без DAST/Falco/мониторинга это уже настоящий CI/CD с
> безопасностью. Потом наращиваешь слои.

Когда поднимешь кластер и захочешь — я помогу написать конкретные артефакты под этот
проект: Helm-чарт для transfermarket, `Jenkinsfile` со всеми стадиями сканирования,
ArgoCD Application-манифесты и сам `install.sh` для air-gapped бандла. Скажи, с чего
начинаем.
