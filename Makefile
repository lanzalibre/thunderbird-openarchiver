WORKDIR       := $(HOME)/openarchiver
SRC_DIR       := $(HOME)/git/open-archiver/open-archiver-src
NAS_PATH      := /Volumes/gmail_emls
NAS_SMB       := smb://santilh@192.168.1.36/home/gmail_emls
DC            := docker compose -f $(WORKDIR)/docker-compose.yml
ENV_FILE      := $(WORKDIR)/.env
LOG_FILE      := /tmp/openarchiver.log
BACKEND_PID   := /tmp/oa-backend.pid
FRONTEND_PID  := /tmp/oa-frontend.pid

RED    := \033[0;31m
GREEN  := \033[0;32m
YELLOW := \033[1;33m
NC     := \033[0m

CONTAINERS := oa-meili oa-valkey

.PHONY: help start stop restart status logs tail check-health \
	start-api stop-api status-api tail-api \
	start-frontend stop-frontend status-frontend tail-frontend \
	start-db stop-db status-db \
	start-search stop-search status-search tail-search \
	start-queue stop-queue status-queue \
	start-workers stop-workers status-workers \
	start-all stop-all status-all \
	check-docker check-nas check-containers

help:
	@echo "Open Archiver — Process Management (for Thunderbird extension development)"
	@echo ""
	@echo "Usage: make <target>"
	@echo ""
	@echo "--- All services ---"
	@echo "  start         Start everything (containers + backend + frontend)"
	@echo "  stop          Stop everything"
	@echo "  restart        Restart everything"
	@echo "  status        Check status of all services"
	@echo "  tail          Tail backend+frontend logs"
	@echo "  check-health  Quick health check of each service"
	@echo ""
	@echo "--- Individual ---"
	@echo "  api           Backend API (port 4000)"
	@echo "  frontend      Web UI (port 3000)"
	@echo "  db            PostgreSQL (port 5432)"
	@echo "  search        Meilisearch (port 7700)"
	@echo "  queue         Valkey/Redis (port 6379)"
	@echo "  workers       Ingestion + Indexing + Scheduler"
	@echo ""
	@echo "  Each service has sub-targets: make <service>-start, <service>-stop, <service>-status"
	@echo "  Frontend and workers also have: make <service>-tail"
	@echo ""
	@echo "--- Utilities ---"
	@echo "  mount-nas     Mount NAS storage"
	@echo "  fix-ingestion  Reset stuck ingestion sources"
	@echo "  migrate       Run database migrations"

# ── All-in-one ──────────────────────────────────────────────────────────

start: start-db start-containers start-backend start-frontend check-health

stop: stop-frontend stop-backend stop-containers

restart: stop start

status: status-all

tail: logs

logs:
	@echo "Tailing logs (Ctrl+C to stop)..."
	@tail -f $(LOG_FILE)

check-health:
	@echo "--- Service Health ---"
	@if pg_isready -U openarchiver -h localhost &>/dev/null; then \
		printf "$(GREEN)[OK]$(NC) PostgreSQL  (port 5432)\n"; \
	else \
		printf "$(RED)[DOWN]$(NC) PostgreSQL  (port 5432)\n"; \
	fi
	@if docker exec oa-valkey valkey-cli --no-auth-warning ping &>/dev/null 2>&1; then \
		printf "$(GREEN)[OK]$(NC) Valkey      (port 6379)\n"; \
	else \
		printf "$(RED)[DOWN]$(NC) Valkey      (port 6379)\n"; \
	fi
	@if curl -s http://localhost:7700/health &>/dev/null; then \
		printf "$(GREEN)[OK]$(NC) Meilisearch (port 7700)\n"; \
	else \
		printf "$(RED)[DOWN]$(NC) Meilisearch (port 7700)\n"; \
	fi
	@code=$$(curl -s -o /dev/null -w '%{http_code}' http://localhost:4000/v1/auth/status 2>/dev/null || echo "000"); \
	if [ "$$code" != "000" ]; then \
		printf "$(GREEN)[OK]$(NC) API         (port 4000) — HTTP $$code\n"; \
	else \
		printf "$(RED)[DOWN]$(NC) API         (port 4000)\n"; \
	fi
	@code=$$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000 2>/dev/null || echo "000"); \
	if [ "$$code" != "000" ]; then \
		printf "$(GREEN)[OK]$(NC) Frontend    (port 3000) — HTTP $$code\n"; \
	else \
		printf "$(RED)[DOWN]$(NC) Frontend    (port 3000)\n"; \
	fi

# ── Docker containers ────────────────────────────────────────────────────

start-containers: check-docker
	@$(DC) up -d
	@sleep 2
	@$(MAKE) --no-print-directory check-containers

stop-containers:
	@if $(DC) ps -q 2>/dev/null | grep -q .; then \
		$(DC) down && printf "$(GREEN)[OK]$(NC) Containers stopped\n"; \
	else \
		printf "$(YELLOW)[AVISO]$(NC) No containers running\n"; \
	fi

check-containers:
	@all_ok=true; \
	for c in $(CONTAINERS); do \
		state=$$(docker inspect -f '{{.State.Status}}' "$$c" 2>/dev/null || echo "missing"); \
		if [ "$$state" = "running" ]; then \
			printf "$(GREEN)[OK]$(NC) %s running\n" "$$c"; \
		else \
			printf "$(RED)[ERROR]$(NC) %s not running (state: %s)\n" "$$c" "$$state"; \
			all_ok=false; \
		fi; \
	done

# ── PostgreSQL ────────────────────────────────────────────────────────────

start-db:
	@if pg_isready -U openarchiver -h localhost &>/dev/null; then \
		printf "$(GREEN)[OK]$(NC) PostgreSQL already running\n"; \
	else \
		echo "Starting PostgreSQL..."; \
		brew services start postgresql@16; \
		sleep 2; \
		if pg_isready -U openarchiver -h localhost &>/dev/null; then \
			printf "$(GREEN)[OK]$(NC) PostgreSQL started\n"; \
		else \
			printf "$(RED)[ERROR]$(NC) PostgreSQL failed to start\n"; \
		fi; \
	fi

stop-db:
	@if pg_isready -U openarchiver -h localhost &>/dev/null; then \
		brew services stop postgresql@16 && printf "$(GREEN)[OK]$(NC) PostgreSQL stopped\n"; \
	else \
		printf "$(YELLOW)[AVISO]$(NC) PostgreSQL not running\n"; \
	fi

status-db:
	@if pg_isready -U openarchiver -h localhost &>/dev/null; then \
		printf "$(GREEN)[OK]$(NC) PostgreSQL running on port 5432\n"; \
	else \
		printf "$(RED)[DOWN]$(NC) PostgreSQL\n"; \
	fi

db: status-db

# ── Meilisearch ───────────────────────────────────────────────────────────

start-search: check-docker
	@if docker inspect -f '{{.State.Status}}' oa-meili 2>/dev/null | grep -q running; then \
		printf "$(GREEN)[OK]$(NC) Meilisearch already running\n"; \
	else \
		$(DC) up -d meilisearch && sleep 2; \
		if curl -s http://localhost:7700/health &>/dev/null; then \
			printf "$(GREEN)[OK]$(NC) Meilisearch started on port 7700\n"; \
		else \
			printf "$(RED)[ERROR]$(NC) Meilisearch failed to start\n"; \
		fi; \
	fi

stop-search:
	@if docker ps -q -f name=oa-meili 2>/dev/null | grep -q .; then \
		docker stop oa-meili && printf "$(GREEN)[OK]$(NC) Meilisearch stopped\n"; \
	else \
		printf "$(YELLOW)[AVISO]$(NC) Meilisearch not running\n"; \
	fi

status-search:
	@if curl -s http://localhost:7700/health &>/dev/null; then \
		printf "$(GREEN)[OK]$(NC) Meilisearch running on port 7700\n"; \
	else \
		printf "$(RED)[DOWN]$(NC) Meilisearch\n"; \
	fi

search: status-search
queue-search: status-search

# ── Valkey ────────────────────────────────────────────────────────────────

start-queue: check-docker
	@if docker inspect -f '{{.State.Status}}' oa-valkey 2>/dev/null | grep -q running; then \
		printf "$(GREEN)[OK]$(NC) Valkey already running\n"; \
	else \
		$(DC) up -d valkey && sleep 1; \
		if docker exec oa-valkey valkey-cli --no-auth-warning ping &>/dev/null 2>&1; then \
			printf "$(GREEN)[OK]$(NC) Valkey started on port 6379\n"; \
		else \
			printf "$(RED)[ERROR]$(NC) Valkey failed to start\n"; \
		fi; \
	fi

stop-queue:
	@if docker ps -q -f name=oa-valkey 2>/dev/null | grep -q .; then \
		docker stop oa-valkey && printf "$(GREEN)[OK]$(NC) Valkey stopped\n"; \
	else \
		printf "$(YELLOW)[AVISO]$(NC) Valkey not running\n"; \
	fi

status-queue:
	@if docker exec oa-valkey valkey-cli --no-auth-warning ping &>/dev/null 2>&1; then \
		printf "$(GREEN)[OK]$(NC) Valkey running on port 6379\n"; \
	else \
		printf "$(RED)[DOWN]$(NC) Valkey\n"; \
	fi

queue: status-queue

# ── Backend API ───────────────────────────────────────────────────────────

start-api:
	@if pgrep -f "node.*open-archiver/dist/index" >/dev/null 2>&1; then \
		printf "$(GREEN)[OK]$(NC) API already running (PID $$(pgrep -f 'node.*open-archiver/dist/index' | head -1))\n"; \
	else \
		echo "Starting backend API..."; \
		nohup sh -c 'cd $(SRC_DIR) && DOTENV_CONFIG_PATH=$(ENV_FILE) node -r dotenv/config packages/backend/dist/index.js' \
			>> $(LOG_FILE) 2>&1 & \
		echo $$! > $(BACKEND_PID); \
		sleep 3; \
		code=$$(curl -s -o /dev/null -w '%{http_code}' http://localhost:4000/v1/auth/status 2>/dev/null || echo "000"); \
		if [ "$$code" != "000" ]; then \
			printf "$(GREEN)[OK]$(NC) API running on http://localhost:4000 (HTTP $$code)\n"; \
		else \
			printf "$(YELLOW)[AVISO]$(NC) API not responding yet. Check logs: make tail-api\n"; \
		fi; \
	fi

stop-api:
	@pkill -f "node.*open-archiver/packages/backend/dist/index" 2>/dev/null && \
		printf "$(GREEN)[OK]$(NC) API stopped\n" || \
		printf "$(YELLOW)[AVISO]$(NC) API was not running\n"
	@rm -f $(BACKEND_PID)

status-api:
	@pid=$$(pgrep -f "node.*open-archiver/packages/backend/dist/index" 2>/dev/null | head -1); \
	if [ -n "$$pid" ]; then \
		code=$$(curl -s -o /dev/null -w '%{http_code}' http://localhost:4000/v1/auth/status 2>/dev/null || echo "000"); \
		printf "$(GREEN)[OK]$(NC) API running (PID $$pid, HTTP $$code on port 4000)\n"; \
	else \
		printf "$(RED)[DOWN]$(NC) API not running\n"; \
	fi

tail-api:
	@tail -f $(LOG_FILE) | grep --line-buffered -E "(API|api|server|listen|error|Error)" 2>/dev/null || tail -f $(LOG_FILE)

api: status-api

# ── Frontend ──────────────────────────────────────────────────────────────

start-frontend:
	@if pgrep -f "node.*packages/frontend/build" >/dev/null 2>&1; then \
		printf "$(GREEN)[OK]$(NC) Frontend already running\n"; \
	else \
		echo "Starting frontend..."; \
		nohup sh -c 'cd $(SRC_DIR) && DOTENV_CONFIG_PATH=$(ENV_FILE) node -r dotenv/config packages/frontend/build/index.js' \
			>> $(LOG_FILE) 2>&1 & \
		echo $$! > $(FRONTEND_PID); \
		sleep 3; \
		code=$$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000 2>/dev/null || echo "000"); \
		if [ "$$code" != "000" ]; then \
			printf "$(GREEN)[OK]$(NC) Frontend running on http://localhost:3000 (HTTP $$code)\n"; \
		else \
			printf "$(YELLOW)[AVISO]$(NC) Frontend not responding yet. Check logs: make tail-frontend\n"; \
		fi; \
	fi

stop-frontend:
	@pkill -f "node.*packages/frontend/build/index" 2>/dev/null && \
		printf "$(GREEN)[OK]$(NC) Frontend stopped\n" || \
		printf "$(YELLOW)[AVISO]$(NC) Frontend was not running\n"
	@rm -f $(FRONTEND_PID)

status-frontend:
	@pid=$$(pgrep -f "node.*packages/frontend/build/index" 2>/dev/null | head -1); \
	if [ -n "$$pid" ]; then \
		code=$$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000 2>/dev/null || echo "000"); \
		printf "$(GREEN)[OK]$(NC) Frontend running (PID $$pid, HTTP $$code on port 3000)\n"; \
	else \
		printf "$(RED)[DOWN]$(NC) Frontend not running\n"; \
	fi

tail-frontend:
	@tail -f $(LOG_FILE) | grep --line-buffered -E "(frontend|svelte|3000)" 2>/dev/null || tail -f $(LOG_FILE)

frontend: status-frontend

# ── Workers ────────────────────────────────────────────────────────────────

WORKER_PIDS := /tmp/oa-ingestion.pid /tmp/oa-indexing.pid /tmp/oa-scheduler.pid

start-workers:
	@echo "Starting workers..."
	@nohup sh -c 'cd $(SRC_DIR) && DOTENV_CONFIG_PATH=$(ENV_FILE) node -r dotenv/config packages/backend/dist/workers/ingestion.worker.js' \
		>> $(LOG_FILE) 2>&1 & \
		echo $$! > /tmp/oa-ingestion.pid; \
		echo "  Ingestion worker started (PID $$!)"
	@nohup sh -c 'cd $(SRC_DIR) && DOTENV_CONFIG_PATH=$(ENV_FILE) node -r dotenv/config packages/backend/dist/workers/indexing.worker.js' \
		>> $(LOG_FILE) 2>&1 & \
		echo $$! > /tmp/oa-indexing.pid; \
		echo "  Indexing worker started (PID $$!)"
	@nohup sh -c 'cd $(SRC_DIR) && DOTENV_CONFIG_PATH=$(ENV_FILE) node -r dotenv/config packages/backend/dist/jobs/schedulers/sync-scheduler.js' \
		>> $(LOG_FILE) 2>&1 & \
		echo $$! > /tmp/oa-scheduler.pid; \
		echo "  Sync scheduler started (PID $$!)"

stop-workers:
	@for pidfile in $(WORKER_PIDS); do \
		if [ -f "$$pidfile" ]; then \
			kill $$(cat "$$pidfile") 2>/dev/null && rm -f "$$pidfile"; \
		fi; \
	done
	@pkill -f "node.*workers/ingestion" 2>/dev/null
	@pkill -f "node.*workers/indexing" 2>/dev/null
	@pkill -f "node.*schedulers/sync-scheduler" 2>/dev/null
	@printf "$(GREEN)[OK]$(NC) Workers stopped (or were not running)\n"

status-workers:
	@echo "--- Workers ---"
	@for pattern in "ingestion.worker" "indexing.worker" "sync-scheduler"; do \
		pid=$$(pgrep -f "node.*$$pattern" 2>/dev/null | head -1); \
		if [ -n "$$pid" ]; then \
			echo "  $$pattern: running (PID $$pid)"; \
		else \
			echo "  $$pattern: not running"; \
		fi; \
	done

workers: status-workers

# ── All services status ──────────────────────────────────────────────────

status-all:
	@echo "============================================"
	@echo "  Open Archiver — Service Status"
	@echo "============================================"
	@echo ""
	@echo "--- Infrastructure ---"
	@$(MAKE) --no-print-directory status-db
	@$(MAKE) --no-print-directory status-search
	@$(MAKE) --no-print-directory status-queue
	@echo ""
	@echo "--- Application ---"
	@$(MAKE) --no-print-directory status-api
	@$(MAKE) --no-print-directory status-frontend
	@echo ""
	@echo "--- Background ---"
	@$(MAKE) --no-print-directory status-workers
	@echo ""
	@echo "--- Storage ---"
	@if mount | grep -q "$(NAS_PATH)"; then \
		printf "$(GREEN)[OK]$(NC) NAS mounted at $(NAS_PATH)\n"; \
	else \
		printf "$(YELLOW)[AVISO]$(NC) NAS not mounted\n"; \
	fi
	@echo ""
	@echo "--- Extension ---"
	@if [ -d "$(HOME)/git/thunderbird_openarchive" ]; then \
		echo "  Thunderbird extension at $(HOME)/git/thunderbird_openarchive"; \
		git -C "$(HOME)/git/thunderbird_openarchive" log --oneline -1 2>/dev/null || true; \
	fi
	@echo "============================================"

# ── Utilities ─────────────────────────────────────────────────────────────

check-docker:
	@if docker info &>/dev/null; then \
		printf "$(GREEN)[OK]$(NC) Docker Desktop running\n"; \
	else \
		printf "$(YELLOW)[AVISO]$(NC) Docker Desktop not running.\n"; \
		printf "  Start it manually or run: open -a Docker\n"; \
		exit 1; \
	fi

mount-nas:
	@if mount | grep -q "$(NAS_PATH)"; then \
		printf "$(GREEN)[OK]$(NC) NAS already mounted at $(NAS_PATH)\n"; \
	else \
		printf "$(YELLOW)[AVISO]$(NC) NAS not mounted. Mounting...\n"; \
		open "$(NAS_SMB)"; \
		sleep 5; \
		if mount | grep -q "$(NAS_PATH)"; then \
			printf "$(GREEN)[OK]$(NC) NAS mounted at $(NAS_PATH)\n"; \
		else \
			printf "$(RED)[ERROR]$(NC) Could not mount NAS\n"; \
		fi; \
	fi

fix-ingestion:
	@if ! pg_isready -U openarchiver -h localhost &>/dev/null; then \
		printf "$(RED)[ERROR]$(NC) PostgreSQL not responding\n"; \
		exit 1; \
	fi
	@psql -U openarchiver -d openarchiver -c "UPDATE ingestion_sources SET status = 'active' WHERE status IN ('syncing', 'error');" 2>/dev/null && \
		printf "$(GREEN)[OK]$(NC) All sources reset to 'active'\n" || \
		printf "$(RED)[ERROR]$(NC) Failed to reset sources\n"

migrate:
	@echo "=== Running migrations ==="
	@cd $(SRC_DIR)/packages/backend && DOTENV_CONFIG_PATH=$(ENV_FILE) npx dotenv-cli -e $(ENV_FILE) -- pnpm db:migrate
