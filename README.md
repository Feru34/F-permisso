# RPA España — Extracción de documentos financieros oficiales (AEAT / TGSS)

Solución in-house de RPA con Playwright para descargar, **bajo consentimiento del titular**, la **Declaración de la Renta (IRPF)** de la AEAT y el **Informe de Vida Laboral** de la TGSS. Autenticación vía **Cl@ve Móvil** con validación humana en bucle (human-in-the-loop).

> Diseño completo en [plan_arquitectura_rpa_espana.md](plan_arquitectura_rpa_espana.md).

## Arquitectura del repo

```
src/
  shared/            Config (zod), tipos, logger (con redacción), Prisma, S3, store de estado
    state/           JobStateStore: memory (dev) | dynamo (prod)
  browser/           Lanzamiento Chromium + playwright-extra/stealth + proxy ES + fingerprint
  scrapers/          BaseScraper + RentaScraper (AEAT) + VidaLaboralScraper (TGSS)
    selectors/       Registros de selectores versionados por sede
  worker/            Entrypoint del worker efímero (1 task = 1 sesión Cl@ve)
  control-plane/     API REST + WebSocket hub + lanzador de worker (local | ECS)
prisma/              schema.prisma (ExtractionJob, ExtractionEvent)
Dockerfile.worker    Imagen Playwright para el worker (Fargate)
Dockerfile.api       Imagen del control-plane
```

## Flujo

1. `POST /extractions` → crea job `PENDING`, lanza worker, responde **202** `{ jobId, wsUrl }`.
2. El frontend se suscribe al WebSocket con `?jobId=`.
3. El worker navega la sede, dispara Cl@ve Móvil, extrae el reto (código 3 letras / QR) y lo publica → evento `CODE_READY`.
4. El usuario valida en su app Cl@ve antes de que expire el timer (~1:20). El worker queda bloqueado esperando que el DOM avance (o `POST /jobs/:id/confirm`).
5. El worker descarga el PDF, lo sube a S3 (SSE-KMS) y actualiza PostgreSQL → evento `COMPLETED` con URL prefirmada.

## Puesta en marcha (local)

```bash
cp .env.example .env          # ajusta DATABASE_URL, proxy, etc.
npm install
npx playwright install chromium
npx prisma migrate dev        # crea las tablas
npm run dev:api               # control-plane (API :8080, WS :8081)
```

Disparar una extracción:

```bash
curl -X POST http://localhost:8080/extractions \
  -H 'content-type: application/json' \
  -d '{"userId":"u_123","docType":"VIDA_LABORAL"}'
```

> En local, `WORKER_LAUNCH_MODE=local` hace spawn del worker como proceso. Con `STATE_BACKEND=memory` el estado no se comparte entre procesos: para el flujo end-to-end usar `STATE_BACKEND=dynamo` o ejecutar contra la infra real.

## Scripts

| Script | Acción |
|---|---|
| `npm run typecheck` | Type-check sin emitir |
| `npm run build` | Compila a `dist/` |
| `npm test` | Tests unitarios (Vitest) |
| `npm run dev:api` | Control-plane en watch |
| `npm run dev:worker` | Worker con `JOB_PARAMS` del entorno |
| `npm run prisma:migrate` | Migraciones Prisma |

## Cómo probar

### Nivel 1 — Sin dependencias externas (lógica)

```bash
npm install
npm run typecheck      # 0 errores
npm test               # 11 tests (state store, validación PDF, FakeScraper)
```

### Nivel 2 — Demo end-to-end OFFLINE (solo necesita Postgres local)

Ejercita el flujo completo (reto Cl@ve → confirmación → PDF → COMPLETED) **sin** navegar a AEAT/TGSS, sin proxy y sin AWS, usando el `FakeScraper`.

```bash
docker compose up -d postgres
cp .env.example .env
# En .env:  WORKER_LAUNCH_MODE=inline  DEV_FAKE_SCRAPE=true  STATE_BACKEND=memory
npx prisma migrate dev --name init
npm run dev:api
```

En otra terminal:

```bash
# 1) Crear extracción → responde 202 { jobId, wsUrl }
curl -X POST http://localhost:8080/extractions \
  -H 'content-type: application/json' \
  -d '{"userId":"u_123","docType":"VIDA_LABORAL"}'

# 2) Suscribirse al WS para ver el reto (evento CODE_READY con code "ABC")
npx wscat -c "ws://localhost:8081?jobId=<JOB_ID>"

# 3) Confirmar la validación (simula el OK en la app móvil Cl@ve)
curl -X POST http://localhost:8080/jobs/<JOB_ID>/confirm

# 4) Estado final (o evento COMPLETED por WS)
curl http://localhost:8080/jobs/<JOB_ID>
```

> Sin cliente WS, basta con sondear `GET /jobs/:id` hasta `status: "COMPLETED"`.

### Nivel 3 — Real (requiere infraestructura)

Proxy residencial ES, `npx playwright install chromium`, credenciales AWS (S3/KMS) y **selectores validados** de AEAT/TGSS. Es el trabajo pendiente del roadmap (secciones 4.2–4.3).

## Estado de implementación

Scaffolding completo y tipado del roadmap. Los **selectores CSS de AEAT/TGSS** (`src/scrapers/selectors/*`) están marcados con `TODO` y deben validarse contra los portales reales — ver checklist en el plan de arquitectura.
