# AWS Deployment Setup — Marketing Dashboard Backend

This guide walks through the **one-time AWS setup** required to run the Marketing Dashboard backend on AWS Lambda with the EventBridge one-shot scheduler. Follow it top-to-bottom the first time. Sections are independent enough that you can redo any one of them if something goes wrong.

> **Audience:** the person deploying the backend (you).
> **Scope:** infrastructure only. All application code is already on the `aws-lambda-eventbridge-scheduler` feature branch.

---

## 1. Architecture overview

```
┌──────────────┐   HTTPS    ┌───────────────────────────────┐
│  Amplify     │ ─────────▶ │  HTTP Lambda                  │
│  (Next.js)   │            │  marketing-dashboard-http     │
└──────────────┘            │  (Mangum + FastAPI)           │
                            │  Function URL, public, NONE   │
                            └─────┬──────────────┬──────────┘
                                  │              │ writes Firestore doc
                                  │              │ + creates EventBridge schedule
                                  ▼              ▼
                          ┌──────────────┐  ┌──────────────────────┐
                          │  Firestore   │  │ EventBridge          │
                          │  (Firebase)  │  │ Scheduler            │
                          └──────▲───────┘  │ (one-shot per post)  │
                                 │          └──────────┬───────────┘
                                 │                     │ fires at exact time
                                 │ updates row         ▼
                          ┌──────┴───────────────────────────────┐
                          │  Scheduler Lambda                    │
                          │  marketing-dashboard-scheduler       │
                          │  (imports publish_one directly,      │
                          │   no HTTP)                           │
                          └──────────────────────────────────────┘
```

**Why two Lambdas?** They share one container image (no duplicate build), but the HTTP Lambda needs Mangum + Function URL, while the Scheduler Lambda is invoked directly by EventBridge with no HTTP layer. Separating them keeps cold-start latency on user-facing routes independent of the scheduler workload.

**Why one-shot EventBridge schedules?** No per-minute polling. The schedule fires once at the post's exact `scheduledForMs`, EventBridge auto-deletes the schedule after firing. Costs ≈ $0 at expected volume.

---

## 2. Prerequisites

Before starting, make sure you have:

- [ ] AWS account with IAM permissions to create: ECR repos, Lambda functions, IAM roles, Secrets Manager secrets, EventBridge schedules.
- [ ] [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html) installed locally.
- [ ] `aws configure` completed with an access key + secret key + default region. Run `aws sts get-caller-identity` to verify.
- [ ] [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running. (Needed to build the Lambda container image.)
- [ ] Repo cloned locally, on branch `aws-lambda-eventbridge-scheduler`.

### Shell choice

This guide uses **bash syntax**. On Windows, use **Git Bash** or **WSL** for the commands. PowerShell users: most commands work but you'll need to swap `EOF` heredocs for `Set-Content` or use `--cli-input-json file://name.json` instead of inline JSON. Or just open Git Bash for this one task.

---

## 3. Values you'll need to fill in

Open a scratch file and collect these before starting. Replace every `<placeholder>` in the commands below with your real value.

| Placeholder | How to get it | Example |
|---|---|---|
| `<region>` | Your choice. Use `us-east-1` if you don't have a strong preference. | `us-east-1` |
| `<account-id>` | `aws sts get-caller-identity --query Account --output text` | `123456789012` |
| `<firebase-project-id>` | From your existing `backend/.env` or [Firebase Console](https://console.firebase.google.com/) → Project Settings → General | `my-marketing-dashboard` |
| `<firebase-service-account-json>` | Firebase Console → Project Settings → Service Accounts → "Generate new private key". Save the JSON file. | (full JSON blob) |
| `<linkedin-client-id>` | From your existing `backend/.env`, or [LinkedIn Developer Portal](https://www.linkedin.com/developers/apps) → your app → Auth tab | `78abcdef...` |
| `<linkedin-client-secret>` | Same source as above | `WPL_AP1.xyz...` |
| `<amplify-domain>` | Amplify Console → your app → top of dashboard. Probably `main.d1234abcd.amplifyapp.com` or a custom domain. | `main.d1abc2def3xyz.amplifyapp.com` |
| `<fernet-key>` | Generate fresh: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`. **STORE THIS SOMEWHERE SAFE — losing it makes every encrypted LinkedIn token in Firestore unrecoverable.** | `tT3...` |
| `<secret-key>` | Generate fresh: `python -c "import secrets; print(secrets.token_urlsafe(32))"` | `xY7...` |

There are also several values you'll learn during the setup (Lambda ARNs, role ARNs, Function URL). I'll mark them in-context as you go.

---

## 4. Set shell variables (run first)

In your bash shell, set these so every subsequent command picks them up automatically:

```bash
export AWS_REGION=us-east-1                    # or your choice
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export ECR_REPO=marketing-dashboard-backend
export ECR_URI=${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}
export FIREBASE_PROJECT_ID=<firebase-project-id>
export AMPLIFY_DOMAIN=<amplify-domain>
```

Verify:

```bash
echo "Region: $AWS_REGION"
echo "Account: $ACCOUNT_ID"
echo "ECR URI: $ECR_URI"
```

---

## 5. Create the ECR repository

```bash
aws ecr create-repository \
  --repository-name $ECR_REPO \
  --region $AWS_REGION
```

If it already exists, you'll get a `RepositoryAlreadyExistsException` — ignore.

---

## 6. Store secrets in Secrets Manager

Generate the keys:

```bash
FERNET_KEY=$(python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")
SECRET_KEY=$(python -c "import secrets; print(secrets.token_urlsafe(32))")
echo "Fernet key: $FERNET_KEY"
echo "Secret key: $SECRET_KEY"
```

**Copy both keys into your password manager NOW.** The Fernet key in particular cannot be regenerated — if you lose it, every encrypted LinkedIn token in Firestore is unrecoverable. (Users would re-connect, but you'd have orphaned secrets.)

Prepare the Firebase service account JSON as an escaped one-line string:

```bash
# Replace path with your downloaded key file
FIREBASE_SA_JSON=$(cat /path/to/firebase-service-account.json | jq -c . | jq -R .)
# Strip the outer quotes that jq -R adds
FIREBASE_SA_JSON=${FIREBASE_SA_JSON:1:-1}
```

(If you don't have `jq` installed, escape the JSON manually: replace every `"` with `\"`, every newline in the private key with `\n`, and put the whole thing inside `"..."`.)

Create the secret:

```bash
aws secretsmanager create-secret \
  --name marketing-dashboard/backend \
  --region $AWS_REGION \
  --description "Marketing Dashboard backend secrets" \
  --secret-string "{
    \"ENCRYPTION_KEY\": \"$FERNET_KEY\",
    \"SECRET_KEY\": \"$SECRET_KEY\",
    \"FIREBASE_SERVICE_ACCOUNT_JSON\": \"$FIREBASE_SA_JSON\",
    \"LINKEDIN_CLIENT_ID\": \"<linkedin-client-id>\",
    \"LINKEDIN_CLIENT_SECRET\": \"<linkedin-client-secret>\"
  }"
```

Save the returned `ARN` — you'll need it in step 7.

```bash
export SECRETS_ARN=<paste-arn-from-response>
```

---

## 7. Create IAM roles

Three roles total, but two are created here. The third (HTTP Lambda → EventBridge Scheduler) gets attached at step 10.

### 7a. Lambda execution role (shared by both Lambdas)

```bash
cat > /tmp/trust-lambda.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Service": "lambda.amazonaws.com"},
    "Action": "sts:AssumeRole"
  }]
}
EOF

aws iam create-role \
  --role-name marketing-dashboard-lambda-execution \
  --assume-role-policy-document file:///tmp/trust-lambda.json

aws iam attach-role-policy \
  --role-name marketing-dashboard-lambda-execution \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
```

Grant it Secrets Manager read access:

```bash
cat > /tmp/secrets-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "secretsmanager:GetSecretValue",
    "Resource": "$SECRETS_ARN"
  }]
}
EOF

aws iam put-role-policy \
  --role-name marketing-dashboard-lambda-execution \
  --policy-name ReadBackendSecrets \
  --policy-document file:///tmp/secrets-policy.json

export LAMBDA_EXEC_ROLE_ARN=$(aws iam get-role --role-name marketing-dashboard-lambda-execution --query 'Role.Arn' --output text)
echo "Lambda execution role: $LAMBDA_EXEC_ROLE_ARN"
```

### 7b. EventBridge Scheduler invoker role

This is what EventBridge assumes when it fires a schedule, in order to invoke the scheduler Lambda.

```bash
cat > /tmp/trust-eventbridge.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Service": "scheduler.amazonaws.com"},
    "Action": "sts:AssumeRole"
  }]
}
EOF

aws iam create-role \
  --role-name marketing-dashboard-eventbridge-invoker \
  --assume-role-policy-document file:///tmp/trust-eventbridge.json

export EVENTBRIDGE_INVOKER_ROLE_ARN=$(aws iam get-role --role-name marketing-dashboard-eventbridge-invoker --query 'Role.Arn' --output text)
echo "EventBridge invoker role: $EVENTBRIDGE_INVOKER_ROLE_ARN"
```

We'll attach the invoke policy after creating the scheduler Lambda (step 9 ARN feeds back into 7c).

---

## 8. Build and push the container image

From the repo root:

```bash
# Authenticate Docker to ECR
aws ecr get-login-password --region $AWS_REGION \
  | docker login --username AWS --password-stdin $ECR_URI

# Build (linux/arm64 — Lambda arm64 is ~20% cheaper and has slightly faster cold starts)
cd backend
docker build -f Dockerfile.lambda -t $ECR_REPO:latest --platform linux/arm64 .

# Tag and push
docker tag $ECR_REPO:latest $ECR_URI:latest
docker push $ECR_URI:latest
cd ..
```

The push typically takes 1–3 minutes the first time (downloading the base image is the slow part). Subsequent pushes only upload changed layers.

---

## 9. Create the scheduler Lambda first

We create this Lambda before the HTTP Lambda because the HTTP Lambda needs the scheduler Lambda's ARN as an env var.

```bash
aws lambda create-function \
  --function-name marketing-dashboard-scheduler \
  --package-type Image \
  --code ImageUri=$ECR_URI:latest \
  --role $LAMBDA_EXEC_ROLE_ARN \
  --image-config 'Command=["app.lambda_scheduler.handler"]' \
  --memory-size 512 \
  --timeout 60 \
  --architectures arm64 \
  --environment "Variables={SECRETS_MANAGER_SECRET_ID=marketing-dashboard/backend,FIREBASE_PROJECT_ID=$FIREBASE_PROJECT_ID}" \
  --region $AWS_REGION

export SCHEDULER_LAMBDA_ARN=$(aws lambda get-function --function-name marketing-dashboard-scheduler --region $AWS_REGION --query 'Configuration.FunctionArn' --output text)
echo "Scheduler Lambda ARN: $SCHEDULER_LAMBDA_ARN"
```

The Lambda will be in `Pending` state for a few seconds while AWS pulls the image. Wait until `aws lambda get-function --function-name marketing-dashboard-scheduler --region $AWS_REGION --query 'Configuration.State'` returns `"Active"`.

---

## 10. Finish the EventBridge invoker role + grant the HTTP Lambda permission to manage schedules

### 10a. Allow EventBridge to invoke the scheduler Lambda

```bash
cat > /tmp/invoke-scheduler-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "lambda:InvokeFunction",
    "Resource": "$SCHEDULER_LAMBDA_ARN"
  }]
}
EOF

aws iam put-role-policy \
  --role-name marketing-dashboard-eventbridge-invoker \
  --policy-name InvokeSchedulerLambda \
  --policy-document file:///tmp/invoke-scheduler-policy.json
```

### 10b. Allow the HTTP Lambda's execution role to manage schedules

```bash
cat > /tmp/scheduler-mgmt-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "scheduler:CreateSchedule",
        "scheduler:DeleteSchedule",
        "scheduler:UpdateSchedule",
        "scheduler:GetSchedule"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "$EVENTBRIDGE_INVOKER_ROLE_ARN"
    }
  ]
}
EOF

aws iam put-role-policy \
  --role-name marketing-dashboard-lambda-execution \
  --policy-name ManageScheduledPostSchedules \
  --policy-document file:///tmp/scheduler-mgmt-policy.json
```

**The `iam:PassRole` line is the most common gotcha.** Creating an EventBridge schedule requires the caller to "pass" the invoker role to EventBridge. Without this, you'll get `AccessDeniedException` on every schedule create.

---

## 11. Create the HTTP Lambda

```bash
aws lambda create-function \
  --function-name marketing-dashboard-http \
  --package-type Image \
  --code ImageUri=$ECR_URI:latest \
  --role $LAMBDA_EXEC_ROLE_ARN \
  --image-config 'Command=["app.main.handler"]' \
  --memory-size 1024 \
  --timeout 30 \
  --architectures arm64 \
  --environment "Variables={SECRETS_MANAGER_SECRET_ID=marketing-dashboard/backend,FIREBASE_PROJECT_ID=$FIREBASE_PROJECT_ID,EVENTBRIDGE_INVOKER_ROLE_ARN=$EVENTBRIDGE_INVOKER_ROLE_ARN,SCHEDULER_LAMBDA_ARN=$SCHEDULER_LAMBDA_ARN,FRONTEND_URL=https://$AMPLIFY_DOMAIN,LINKEDIN_SCOPES=openid profile email w_member_social}" \
  --region $AWS_REGION
```

Wait for `State: Active` (same as before).

---

## 12. Create the Function URL

```bash
aws lambda create-function-url-config \
  --function-name marketing-dashboard-http \
  --auth-type NONE \
  --cors "{\"AllowOrigins\":[\"https://$AMPLIFY_DOMAIN\"],\"AllowMethods\":[\"GET\",\"POST\",\"OPTIONS\"],\"AllowHeaders\":[\"authorization\",\"content-type\"],\"MaxAge\":86400}" \
  --region $AWS_REGION

# Allow public invocation of the URL
aws lambda add-permission \
  --function-name marketing-dashboard-http \
  --statement-id FunctionURLAllowPublicAccess \
  --action lambda:InvokeFunctionUrl \
  --principal "*" \
  --function-url-auth-type NONE \
  --region $AWS_REGION

export FUNCTION_URL=$(aws lambda get-function-url-config --function-name marketing-dashboard-http --region $AWS_REGION --query 'FunctionUrl' --output text)
echo "Function URL: $FUNCTION_URL"
```

**Save the Function URL.** This is your `NEXT_PUBLIC_API_URL`. It looks like `https://abc123xyz.lambda-url.us-east-1.on.aws/`.

---

## 13. Update the HTTP Lambda's `BACKEND_URL`

Now that you have the Function URL, set it back on the Lambda so the OAuth callback URL the backend constructs matches what LinkedIn redirects to:

```bash
aws lambda update-function-configuration \
  --function-name marketing-dashboard-http \
  --environment "Variables={SECRETS_MANAGER_SECRET_ID=marketing-dashboard/backend,FIREBASE_PROJECT_ID=$FIREBASE_PROJECT_ID,EVENTBRIDGE_INVOKER_ROLE_ARN=$EVENTBRIDGE_INVOKER_ROLE_ARN,SCHEDULER_LAMBDA_ARN=$SCHEDULER_LAMBDA_ARN,FRONTEND_URL=https://$AMPLIFY_DOMAIN,LINKEDIN_SCOPES=openid profile email w_member_social,BACKEND_URL=$FUNCTION_URL}" \
  --region $AWS_REGION
```

> AWS Lambda replaces the entire `Variables` map on update. The full set of vars must be in every update call. The command above includes them all.

---

## 14. Update LinkedIn redirect URI

Go to [LinkedIn Developer Portal](https://www.linkedin.com/developers/apps) → your app → **Auth** tab → **Authorized redirect URLs**. Add:

```
<function-url>/api/v1/auth/linkedin/callback
```

(Drop the trailing slash from the function URL; the path is exactly `/api/v1/auth/linkedin/callback`.)

Keep the localhost entry too — you'll still use it for local dev.

---

## 15. Update Amplify and redeploy

Amplify Console → your app → **Environment variables** → set:

```
NEXT_PUBLIC_API_URL = <function-url>
```

Trigger a redeploy via Amplify Console → **Redeploy this version** on the latest build, or push a new commit.

---

## 16. End-to-end verification

### 16a. Health check the Lambda directly

```bash
curl $FUNCTION_URL/health
# Expected: {"status":"ok"} or similar
```

If this 5xxs or times out, check CloudWatch Logs:

```bash
aws logs tail /aws/lambda/marketing-dashboard-http --region $AWS_REGION --follow
```

### 16b. OAuth flow

1. Open your Amplify-hosted frontend (`https://<amplify-domain>`).
2. Log in with Firebase.
3. Go to **Settings** → **Integrations** → **Connect LinkedIn**.
4. Approve on LinkedIn's consent screen.
5. You should land back at `Settings?integration=linkedin&status=connected`.
6. The Settings page should show LinkedIn as Connected.

### 16c. Schedule a test post

1. Generate a draft on `/storyboard` and adapt it for LinkedIn on `/publish`.
2. Pick a date/time **2 minutes in the future**.
3. Click Schedule.
4. Expected: success toast, post appears in the "Upcoming" list.

### 16d. Confirm EventBridge schedule was created

```bash
aws scheduler list-schedules --region $AWS_REGION --query 'Schedules[?starts_with(Name, `publish-`)].Name'
```

Should list one entry like `publish-<some-firestore-doc-id>`.

### 16e. Wait for it to fire (~2 min)

```bash
# Watch the scheduler Lambda's logs in real time
aws logs tail /aws/lambda/marketing-dashboard-scheduler --region $AWS_REGION --follow
```

You should see one invocation at the scheduled time. Look for `outcome: published` in the log line.

### 16f. Confirm LinkedIn

Refresh your LinkedIn feed in a browser. The post should be live.

### 16g. Confirm Firestore status

In the Firebase Console, navigate to `users/<your-uid>/scheduledPosts/<doc-id>`. The doc should have:
- `status: "published"`
- `postUrn: "urn:li:share:..."`
- `postUrl: "https://www.linkedin.com/feed/update/urn:li:share:..."`
- `publishedAtMs: <timestamp>`
- `eventBridgeScheduleName: "publish-<doc-id>"` (still present; the schedule itself was auto-deleted by EventBridge)

---

## 17. Common operations

### 17a. Redeploy after code changes

```bash
cd backend
docker build -f Dockerfile.lambda -t $ECR_REPO:latest --platform linux/arm64 .
docker tag $ECR_REPO:latest $ECR_URI:latest
docker push $ECR_URI:latest

aws lambda update-function-code --function-name marketing-dashboard-http --image-uri $ECR_URI:latest --region $AWS_REGION
aws lambda update-function-code --function-name marketing-dashboard-scheduler --image-uri $ECR_URI:latest --region $AWS_REGION
cd ..
```

Lambda will be `Pending` while it pulls the new image (10–30s), then `Active`.

### 17b. View logs

```bash
# HTTP Lambda (FastAPI / Mangum)
aws logs tail /aws/lambda/marketing-dashboard-http --region $AWS_REGION --follow

# Scheduler Lambda (publishes)
aws logs tail /aws/lambda/marketing-dashboard-scheduler --region $AWS_REGION --follow
```

### 17c. List pending scheduled posts

```bash
aws scheduler list-schedules --region $AWS_REGION --query 'Schedules[?starts_with(Name, `publish-`)].{Name:Name,State:State,Next:CreationDate}'
```

### 17d. Delete a specific scheduled post's EventBridge entry

(If a Firestore doc was deleted out-of-band and a stray schedule survived.)

```bash
aws scheduler delete-schedule --name publish-<doc-id> --region $AWS_REGION
```

### 17e. Rotate secrets

```bash
aws secretsmanager update-secret \
  --secret-id marketing-dashboard/backend \
  --secret-string '{ ... new JSON ... }' \
  --region $AWS_REGION

# Force the Lambdas to pick up new secrets immediately (otherwise the warm container keeps the old values until next cold start)
aws lambda update-function-configuration --function-name marketing-dashboard-http --description "rotated $(date +%s)" --region $AWS_REGION
aws lambda update-function-configuration --function-name marketing-dashboard-scheduler --description "rotated $(date +%s)" --region $AWS_REGION
```

---

## 18. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `curl <function-url>/health` returns 5xx | Lambda cold-start failing | `aws logs tail /aws/lambda/marketing-dashboard-http` — look for ImportError, missing env var, Secrets Manager AccessDenied |
| Scheduling a post returns 502 with `eventbridge_create_failed` | `iam:PassRole` permission missing, or `EVENTBRIDGE_INVOKER_ROLE_ARN`/`SCHEDULER_LAMBDA_ARN` env vars wrong | Recheck step 10b. Confirm env vars: `aws lambda get-function-configuration --function-name marketing-dashboard-http --query 'Environment.Variables'` |
| LinkedIn connect fails with `redirect_uri_mismatch` | LinkedIn app doesn't have the new callback URL | Step 14 — add `<function-url>/api/v1/auth/linkedin/callback` to LinkedIn app authorized redirect URLs |
| Scheduler Lambda fires but post doesn't appear on LinkedIn | LinkedIn API 401 (token expired) | Check the Firestore doc — `status` should be `failed` with `failureReason: token_expired`. User needs to reconnect via `/settings#integrations`. |
| Schedule fires at wrong time | Time zone confusion. `scheduledForMs` is UTC ms, EventBridge uses UTC. | Confirm the doc's `scheduledForMs` matches what you intended. The Publish page's date picker writes UTC ms via `parseScheduledAtInputValue`. |
| Frontend → backend call fails with CORS error | CORS allowlist on Function URL doesn't include the Amplify domain | Step 12, re-run `update-function-url-config` with the correct AllowOrigins |
| `AccessDeniedException` on schedule create | The HTTP Lambda's execution role lacks `scheduler:CreateSchedule` or `iam:PassRole` | Step 10b — re-attach `ManageScheduledPostSchedules` policy |

---

## 19. Costs

Expected monthly cost at low usage (1–100 scheduled posts/day, ~100 OAuth/publish-now interactions/day):

| Resource | Cost |
|---|---|
| Lambda invocations + duration | Free tier covers this (~$0) |
| ECR storage (one image, ~150MB) | ~$0.10 |
| Secrets Manager | $0.40 per secret/month |
| CloudWatch Logs | ~$0–1 (mostly free tier) |
| EventBridge Scheduler | Free under 14M invocations/month |
| Data transfer | Free tier covers this |

**Total: ~$1–2 / month.**

---

## 20. What's next (planned, not built yet)

The current implementation is "Pattern B" — one-shot EventBridge schedules per post, no recurring sweep. Documented planned improvements (see `specs/automation.md` §5.5):

1. **Safety-net sweeper.** A second EventBridge schedule (recurring, every 10–15 minutes) invokes the same scheduler Lambda with `{"mode": "sweep"}`. The sweep code path queries Firestore for stuck/orphaned `scheduled` rows older than expected and publishes them. Catches the rare case where an EventBridge schedule fails to fire or is accidentally deleted. ~$0 cost; high reliability value once a few real users depend on this.

2. **Reschedule / cancel UI.** Frontend buttons that call `eventbridge_scheduler.update_schedule()` / `delete_schedule()` (helpers already exist server-side).

3. **Additional platforms.** Twitter/X, Medium, etc. Same pattern — each platform gets its own publisher in `backend/app/services/`, and `scheduler_worker.publish_one` dispatches based on `platforms[0]`.

---

## Appendix A — Information still needed from you

(Filled in by the user as you go — placeholder section the AI assistant will reference.)

- AWS account ID: _______________
- AWS region: _______________
- Amplify production domain: _______________
- Firebase service account JSON path: _______________
- LinkedIn client ID (if not in current `.env`): _______________
- LinkedIn client secret (if not in current `.env`): _______________

---

## Appendix B — Tearing it all down

If you ever need to wipe and restart:

```bash
# Delete schedules first (otherwise they'll fail to find their target Lambda)
aws scheduler list-schedules --region $AWS_REGION --query 'Schedules[?starts_with(Name, `publish-`)].Name' --output text \
  | tr '\t' '\n' \
  | xargs -I {} aws scheduler delete-schedule --name {} --region $AWS_REGION

# Lambdas
aws lambda delete-function --function-name marketing-dashboard-http --region $AWS_REGION
aws lambda delete-function --function-name marketing-dashboard-scheduler --region $AWS_REGION

# IAM roles (must detach policies first)
aws iam delete-role-policy --role-name marketing-dashboard-lambda-execution --policy-name ReadBackendSecrets
aws iam delete-role-policy --role-name marketing-dashboard-lambda-execution --policy-name ManageScheduledPostSchedules
aws iam detach-role-policy --role-name marketing-dashboard-lambda-execution --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
aws iam delete-role --role-name marketing-dashboard-lambda-execution

aws iam delete-role-policy --role-name marketing-dashboard-eventbridge-invoker --policy-name InvokeSchedulerLambda
aws iam delete-role --role-name marketing-dashboard-eventbridge-invoker

# Secrets (NOTE: 7-day recovery window by default — append --force-delete-without-recovery to skip)
aws secretsmanager delete-secret --secret-id marketing-dashboard/backend --region $AWS_REGION

# ECR
aws ecr delete-repository --repository-name $ECR_REPO --force --region $AWS_REGION
```
