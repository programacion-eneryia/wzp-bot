#!/usr/bin/env bash
# =============================================================================
# Despliega la API (imagen Docker) en AWS Lightsail Containers.
# Alternativa a App Runner (bloqueado en algunas cuentas): HTTPS y dominio
# públicos automáticos, precio fijo, misma imagen Docker.
#
# Requisitos:
#   - Imagen local etiquetada como `wzp-api:latest` (build con infra/deploy-api.sh)
#   - Plugin `lightsailctl` en el PATH
#
# Uso:
#   set -a; source .env.production; set +a
#   AWS_REGION=eu-central-1 ./infra/lightsail-deploy.sh
# =============================================================================
set -euo pipefail

AWS_REGION="${AWS_REGION:-eu-central-1}"
SERVICE="${SERVICE:-wzp-api}"
POWER="${POWER:-micro}"          # nano(0.25/0.5GB) micro(0.25/1GB) small(0.5/2GB)
SCALE="${SCALE:-1}"
LOCAL_IMAGE="${LOCAL_IMAGE:-wzp-api:latest}"
CONTAINER="${CONTAINER:-api}"
PORT="${PORT:-3001}"

# 1) Crea el servicio de contenedores si no existe.
if ! aws lightsail get-container-services --service-name "$SERVICE" --region "$AWS_REGION" >/dev/null 2>&1; then
  echo "==> Creando container service '${SERVICE}' (power=${POWER}, scale=${SCALE})"
  aws lightsail create-container-service \
    --service-name "$SERVICE" --power "$POWER" --scale "$SCALE" \
    --region "$AWS_REGION" >/dev/null
fi

# 2) Espera a que el servicio esté READY (puede tardar unos minutos).
echo "==> Esperando a que el servicio esté READY..."
for i in $(seq 1 60); do
  STATE="$(aws lightsail get-container-services --service-name "$SERVICE" --region "$AWS_REGION" \
    --query 'containerServices[0].state' --output text)"
  echo "    estado: ${STATE}"
  [ "$STATE" = "READY" ] && break
  [ "$STATE" = "RUNNING" ] && break
  sleep 10
done

# 3) Sube la imagen local a la registry de Lightsail.
echo "==> Subiendo imagen ${LOCAL_IMAGE} a Lightsail..."
aws lightsail push-container-image \
  --service-name "$SERVICE" --label "$CONTAINER" \
  --image "$LOCAL_IMAGE" --region "$AWS_REGION"

# 4) Obtiene la referencia de la imagen recién subida (p.ej. ":wzp-api.api.1").
IMAGE_REF="$(aws lightsail get-container-images --service-name "$SERVICE" --region "$AWS_REGION" \
  --query 'containerImages[0].image' --output text)"
echo "==> Imagen en Lightsail: ${IMAGE_REF}"

# 5) Construye el JSON de contenedores + endpoint público con las variables de entorno.
DEPLOY_JSON="$(python3 - "$IMAGE_REF" "$CONTAINER" "$PORT" <<'PY'
import json, os, sys
image_ref, container, port = sys.argv[1], sys.argv[2], sys.argv[3]
keys = [
  "NODE_ENV","API_PORT","WEB_URL","API_URL","CORS_ORIGINS","WEBHOOK_BASE_URL",
  "SUPABASE_URL","SUPABASE_ANON_KEY","SUPABASE_SERVICE_ROLE_KEY","DATABASE_URL",
  "REDIS_URL","UNIPILE_DSN","UNIPILE_API_KEY","UNIPILE_WEBHOOK_SECRET",
  "OPENROUTER_API_KEY","OPENROUTER_DEFAULT_MODEL","FIELD_ENCRYPTION_KEY",
  "META_APP_ID","META_WEBHOOK_VERIFY_TOKEN","META_APP_SECRET","META_CAPI_TOKEN","META_GRAPH_VERSION",
]
env = {k: os.environ[k] for k in keys if os.environ.get(k)}
env["API_PORT"] = port
containers = {
  container: {
    "image": image_ref,
    "ports": {port: "HTTP"},
    "environment": env,
  }
}
endpoint = {
  "containerName": container,
  "containerPort": int(port),
  "healthCheck": {
    "path": "/api/health",
    "intervalSeconds": 10,
    "timeoutSeconds": 5,
    "healthyThreshold": 2,
    "unhealthyThreshold": 5,
    "successCodes": "200-499",
  },
}
print(json.dumps({"containers": containers, "endpoint": endpoint}))
PY
)"

CONTAINERS_JSON="$(python3 -c 'import json,sys; print(json.dumps(json.loads(sys.argv[1])["containers"]))' "$DEPLOY_JSON")"
ENDPOINT_JSON="$(python3 -c 'import json,sys; print(json.dumps(json.loads(sys.argv[1])["endpoint"]))' "$DEPLOY_JSON")"

# 6) Crea el deployment.
echo "==> Creando deployment..."
aws lightsail create-container-service-deployment \
  --service-name "$SERVICE" --region "$AWS_REGION" \
  --containers "$CONTAINERS_JSON" \
  --public-endpoint "$ENDPOINT_JSON" >/dev/null

# 7) Espera a que el deployment quede activo y muestra la URL pública.
echo "==> Esperando a que el deployment esté activo (health check /api/health)..."
for i in $(seq 1 60); do
  STATE="$(aws lightsail get-container-services --service-name "$SERVICE" --region "$AWS_REGION" \
    --query 'containerServices[0].state' --output text)"
  DEPLOY_STATE="$(aws lightsail get-container-services --service-name "$SERVICE" --region "$AWS_REGION" \
    --query 'containerServices[0].currentDeployment.state' --output text 2>/dev/null || echo '-')"
  echo "    servicio: ${STATE} | deployment: ${DEPLOY_STATE}"
  [ "$STATE" = "RUNNING" ] && [ "$DEPLOY_STATE" = "ACTIVE" ] && break
  sleep 10
done

URL="$(aws lightsail get-container-services --service-name "$SERVICE" --region "$AWS_REGION" \
  --query 'containerServices[0].url' --output text)"
echo ""
echo "==> API pública: ${URL}"
echo "==> Health: ${URL%/}/api/health"
echo "==> Úsala en NEXT_PUBLIC_API_URL, API_URL, WEBHOOK_BASE_URL y CORS."
