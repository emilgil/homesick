include .env
export

SSH=ssh -i $(SSH_KEY) $(HA_USER)@$(HA_HOST)
SCP=scp -i $(SSH_KEY)
HA_API=http://$(HA_HOST):$(HA_PORT)/api
AUTH=-H "Authorization: Bearer $(HA_TOKEN)"

.PHONY: deploy restart deploy-backend deploy-frontend deploy-frontend-only validate logs enable-debug disable-debug

deploy: validate deploy-backend deploy-frontend restart

deploy-frontend-only: deploy-frontend
	@echo "Frontend deployed (no restart needed — reload browser)"

validate:
	@echo "Validating JSON files..."
	@python3 -m json.tool custom_components/homesick/manifest.json > /dev/null && echo "  OK: manifest.json"
	@python3 -m json.tool custom_components/homesick/strings.json > /dev/null && echo "  OK: strings.json"
	@python3 -m json.tool custom_components/homesick/translations/sv.json > /dev/null && echo "  OK: sv.json"
	@python3 -m json.tool custom_components/homesick/translations/en.json > /dev/null && echo "  OK: en.json"
	@echo "Validation done."

deploy-backend:
	$(SCP) -r custom_components/homesick $(HA_USER)@$(HA_HOST):/config/custom_components/

deploy-frontend:
	$(SSH) "mkdir -p /config/www/homesick"
	$(SCP) -r www/homesick/ $(HA_USER)@$(HA_HOST):/config/www/

restart:
	curl -s -o /dev/null -w 'HTTP %{http_code}\n' -X POST $(HA_API)/services/homeassistant/restart \
		-H "Content-Type: application/json" $(AUTH) || true
	@echo "HA restarting..."

logs:
	@$(SSH) "ha core logs 2>/dev/null | grep -i homesick | tail -50"

enable-debug:
	@curl -s -o /dev/null -X POST $(HA_API)/services/logger/set_level \
		-H "Content-Type: application/json" $(AUTH) \
		-d '{"custom_components.homesick": "debug"}' \
		&& echo "Debug logging enabled for homesick"

disable-debug:
	@curl -s -o /dev/null -X POST $(HA_API)/services/logger/set_level \
		-H "Content-Type: application/json" $(AUTH) \
		-d '{"custom_components.homesick": "warning"}' \
		&& echo "Debug logging disabled"
