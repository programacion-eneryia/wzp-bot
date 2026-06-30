#!/usr/bin/env bash
# =============================================================================
# Crea (primera vez) el servicio App Runner de la API desde la imagen de ECR,
# con el rol de acceso a ECR y las variables de entorno de producción.
#
# Uso:
#   set -a; source .env.production; set +a       # carga las variables de la API
#   AWS_REGION=eu-central-1 ./infra/apprunner-create.sh
# =============================================================================
set -euo pipefail

AWS_REGION="${AWS_REGION:-eu-central-1}"
ECR_REPO="${ECR_REPO:-wzp-api}"
SERVICE="${SERVICE:-wzp-api}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
ROLE_NAME="${ROLE_NAME:-AppRunnerECRAccessRole}"

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
REGISTRY="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
IMAGE_URI="${REGISTRY}/${ECR_REPO}:${IMAGE_TAG}"

# 1) Rol IAM que permite a App Runner descargar la imagen de ECR (idempotente).
if ! aws iam get-role --role-name "${ROLE_NAME}" >/dev/null 2>&1; then
  echo "==> Creando rol ${ROLE_NAME}"
  aws iam create-role --role-name "${ROLE_NAME}" \
    --assume-role-policy-document '{
      "Version":"2012-10-17",
      "Statement":[{"Effect":"Allow","Principal":{"Service":"build.apprunner.amazonaws.com"},"Action":"sts:AssumeRole"}]
    }' >/dev/null
  aws iam attach-role-policy --role-name "${ROLE_NAME}" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess >/dev/null
  sleep 8
fi
ROLE_ARN="$(aws iam get-role --role-name "${ROLE_NAME}" --query 'Role.Arn' --output text)"

# 2) Construye el JSON de variables de entorno (runtime) a partir del entorno.
ENV_JSON="$(python3 - <<'PY'
import json, os
keys = [
  "NODE_ENV","API_PORT","WEB_URL","API_URL","CORS_ORIGINS","WEBHOOK_BASE_URL",
  "SUPABASE_URL","SUPABASE_ANON_KEY","SUPABASE_SERVICE_ROLE_KEY","DATABASE_URL",
  "REDIS_URL","UNIPILE_DSN","UNIPILE_API_KEY","UNIPILE_WEBHOOK_SECRET",
  "OPENROUTER_API_KEY","OPENROUTER_DEFAULT_MODEL","FIELD_ENCRYPTION_KEY",
  "META_APP_ID","META_WEBHOOK_VERIFY_TOKEN","META_APP_SECRET","META_CAPI_TOKEN","META_GRAPH_VERSION",
]
print(json.dumps({k: os.environ[k] for k in keys if os.environ.get(k)}))
PY
)"

# 3) Configuración de origen (imagen ECR + puerto + env).
SRC_CONFIG="$(python3 - "$IMAGE_URI" "$ROLE_ARN" "$ENV_JSON" <<'PY'
import json, sys
image, role_arn, env_json = sys.argv[1], sys.argv[2], sys.argv[3]
cfg = {
  "ImageRepository": {
    "ImageIdentifier": image,
    "ImageRepositoryType": "ECR",
    "ImageConfiguration": {
      "Port": "3001",
      "RuntimeEnvironmentVariables": json.loads(env_json),
    },
  },
  "AutoDeploymentsEnabled": True,
  "AuthenticationConfiguration": {"AccessRoleArn": role_arn},
}
print(json.dumps(cfg))
PY
)"

echo "==> Creando servicio App Runner '${SERVICE}'"
aws apprunner create-service \
  --service-name "${SERVICE}" \
  --region "${AWS_REGION}" \
  --source-configuration "${SRC_CONFIG}" \
  --instance-configuration 'Cpu=1024,Memory=2048' \
  --health-check-configuration 'Protocol=HTTP,Path=/api/health,Interval=10,Timeout=5,HealthyThreshold=1,UnhealthyThreshold=5' \
  --query 'Service.ServiceUrl' --output text

echo ""
echo "==> Servicio creado. La URL de arriba es tu API pública (https://...awsapprunner.com)."
echo "==> Úsala en: NEXT_PUBLIC_API_URL, API_URL, WEBHOOK_BASE_URL y CORS del frontend."
