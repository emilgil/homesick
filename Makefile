include .env
export

SSH=ssh -i $(SSH_KEY) $(HA_USER)@$(HA_HOST)
SCP=scp -i $(SSH_KEY)
HA_API=http://$(HA_HOST):$(HA_PORT)/api
AUTH=-H "Authorization: Bearer $(HA_TOKEN)"

.PHONY: deploy restart deploy-backend deploy-frontend validate logs enable-debug disable-debug

deploy: validate deploy-backend deploy-frontend restart

validate:
	@echo "Validerar JSON-filer..."
	@python3 -m json.tool custom_components/sjukjournal/manifest.json > /dev/null && echo "  OK: manifest.json"
	@python3 -m json.tool custom_components/sjukjournal/strings.json > /dev/null && echo "  OK: strings.json"
	@python3 -m json.tool custom_components/sjukjournal/translations/sv.json > /dev/null && echo "  OK: sv.json"
	@python3 -m json.tool custom_components/sjukjournal/translations/en.json > /dev/null && echo "  OK: en.json"
	@echo "Validering klar."

deploy-backend:
	$(SCP) -r custom_components/sjukjournal $(HA_USER)@$(HA_HOST):/config/custom_components/

deploy-frontend:
	$(SSH) "mkdir -p /config/www/sjukjournal"
	$(SCP) www/sjukjournal/sjukjournal-card.js $(HA_USER)@$(HA_HOST):/config/www/sjukjournal/

restart:
	curl -s -o /dev/null -w 'HTTP %{http_code}\n' -X POST $(HA_API)/services/homeassistant/restart \
		-H "Content-Type: application/json" $(AUTH) || true
	@echo "HA startar om..."

logs:
	@$(SSH) "ha core logs 2>/dev/null | grep -i sjukjournal | tail -50"

enable-debug:
	@curl -s -o /dev/null -X POST $(HA_API)/services/logger/set_level \
		-H "Content-Type: application/json" $(AUTH) \
		-d '{"custom_components.sjukjournal": "debug"}' \
		&& echo "Debug-loggning aktiverad för sjukjournal"

disable-debug:
	@curl -s -o /dev/null -X POST $(HA_API)/services/logger/set_level \
		-H "Content-Type: application/json" $(AUTH) \
		-d '{"custom_components.sjukjournal": "warning"}' \
		&& echo "Debug-loggning avaktiverad"
