PY ?= .venv/bin/python
.PHONY: setup web dev api demo seed test e2e check docker

setup:            ## install Python + web dependencies
	python3 -m venv .venv
	.venv/bin/pip install -q -e '.[dev]'
	cd web && npm install

web:              ## build the web UI into web/dist (served by the API)
	cd web && npm run build

api:              ## run the API (serves web/dist if built)
	$(PY) -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

dev:              ## API on :8000 + Vite dev server on :5173 (hot reload)
	$(MAKE) -j2 api web-dev

web-dev:
	cd web && npm run dev -- --host

seed:             ## load the fictional Maple Grove demo school
	$(PY) -m scripts.seed_demo

demo:             ## offline demo: fake runtime, demo data, built UI — no GPU needed
	RUNTIME_KIND=fake CHAT_MODEL=fake-chat EMBED_MODEL=fake-embed DATA_DIR=./data-demo $(PY) -m scripts.seed_demo
	RUNTIME_KIND=fake CHAT_MODEL=fake-chat EMBED_MODEL=fake-embed DATA_DIR=./data-demo $(PY) -m uvicorn app.main:app --port 8000

test:             ## unit + API tests (no GPU, no network)
	$(PY) -m pytest -q

e2e: web          ## browser smoke test + accessibility audit
	LS_E2E=1 $(PY) -m pytest tests/e2e -q

check: test       ## everything CI should run
	cd web && npm run typecheck

docker:           ## build the app image
	docker build -t localschool .
