#!/usr/bin/env bash
# =============================================================================
# Despliega la API (NestJS + workers) en AWS App Runner usando una imagen en ECR.
#
# Requisitos:
#   - AWS CLI v2 configurada (aws configure) con permisos de ECR + App Runner + IAM.
#   - Docker en marcha.
#
# Uso:
#   AWS_REGION=eu-central-1 ./infra/deploy-api.sh
#
# Variables opcionales:
#   ECR_REPO   (por defecto: wzp-api)
#   SERVICE    (por defecto: wzp-api)
#   IMAGE_TAG  (por defecto: latest)
# =============================================================================
set -euo pipefail

AWS_REGION="${AWS_REGION:-eu-central-1}"
ECR_REPO="${ECR_REPO:-wzp-api}"
SERVICE="${SERVICE:-wzp-api}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
REGISTRY="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
IMAGE_URI="${REGISTRY}/${ECR_REPO}:${IMAGE_TAG}"

echo "==> Cuenta AWS: ${ACCOUNT_ID}  |  Región: ${AWS_REGION}"
echo "==> Imagen destino: ${IMAGE_URI}"

# 1) Repositorio ECR (idempotente).
aws ecr describe-repositories --repository-names "${ECR_REPO}" --region "${AWS_REGION}" >/dev/null 2>&1 \
  || aws ecr create-repository --repository-name "${ECR_REPO}" --region "${AWS_REGION}" \
       --image-scanning-configuration scanOnPush=true >/dev/null

# 2) Login en ECR.
aws ecr get-login-password --region "${AWS_REGION}" \
  | docker login --username AWS --password-stdin "${REGISTRY}"

# 3) Build (desde la raíz del repo) para linux/amd64 (App Runner es x86_64).
docker build --platform linux/amd64 -f apps/api/Dockerfile -t "${IMAGE_URI}" .

# 4) Push.
docker push "${IMAGE_URI}"

echo ""
echo "==> Imagen publicada: ${IMAGE_URI}"
echo "==> Si el servicio App Runner '${SERVICE}' ya existe, despliega la nueva imagen:"
echo "    aws apprunner start-deployment --service-arn <ARN> --region ${AWS_REGION}"
echo ""
echo "==> Para CREARLO la primera vez necesitas un rol de acceso a ECR."
echo "    Ver infra/apprunner-create.sh"
