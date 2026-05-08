# Deploy AI Sales Operator -> VPS  (changed files only)
# Run: powershell -ExecutionPolicy Bypass -File deploy_vps.ps1

$ErrorActionPreference = 'Continue'

$pw  = 'u2uQ]7gqM9\`KM7'
$hk  = 'ssh-ed25519 255 SHA256:aKrMN8wFCNgXHFyUkzpv90weo7MXV/E2J0Xc1VW8KIo'
$vps = 'root@45.14.14.237'
$src = 'C:\Users\Administrator\Desktop\ai-helper'
$rem = '/home/aisales/app'

function SSH($cmd) {
    Write-Host "  SSH> $($cmd.Substring(0,[Math]::Min(90,$cmd.Length)))" -ForegroundColor Cyan
    $bat = "@echo off`r`n`"C:\Program Files\PuTTY\plink.exe`" -ssh -batch -pw `"$pw`" -hostkey `"$hk`" $vps `"$cmd`""
    [System.IO.File]::WriteAllBytes('C:\Temp\run.bat', [System.Text.Encoding]::ASCII.GetBytes($bat))
    cmd /c 'C:\Temp\run.bat' 2>&1
}

function SCP($local, $remPath) {
    Write-Host "  SCP> $local" -ForegroundColor DarkCyan
    $bat = "@echo off`r`n`"C:\Program Files\PuTTY\pscp.exe`" -pw `"$pw`" -hostkey `"$hk`" `"$local`" ${vps}:${remPath}"
    [System.IO.File]::WriteAllBytes('C:\Temp\copy.bat', [System.Text.Encoding]::ASCII.GetBytes($bat))
    cmd /c 'C:\Temp\copy.bat' 2>&1
}

# ── STEP 1: connection test ────────────────────────────────────────────────────
Write-Host "`n====== STEP 1: connection test ======" -ForegroundColor Yellow
$r = SSH 'echo SSH_OK'
if ($r -notmatch 'SSH_OK') { Write-Host "FAILED: $r" -ForegroundColor Red; exit 1 }
Write-Host "OK" -ForegroundColor Green

# ── STEP 2: ensure new directories exist ──────────────────────────────────────
Write-Host "`n====== STEP 2: mkdir new dirs ======" -ForegroundColor Yellow
SSH "mkdir -p $rem/server/config $rem/server/routes/channels $rem/server/services/utils $rem/server/types $rem/migrations/meta"

# ── STEP 3: client files ──────────────────────────────────────────────────────
Write-Host "`n====== STEP 3: client files ======" -ForegroundColor Yellow
SCP "$src\client\src\components\conversation-list.tsx" "$rem/client/src/components/conversation-list.tsx"
SCP "$src\client\src\components\customer-card.tsx"     "$rem/client/src/components/customer-card.tsx"
SCP "$src\client\src\pages\admin-tenants.tsx"          "$rem/client/src/pages/admin-tenants.tsx"
SCP "$src\client\src\pages\conversations.tsx"          "$rem/client/src/pages/conversations.tsx"
SCP "$src\client\src\pages\dashboard.tsx"              "$rem/client/src/pages/dashboard.tsx"
SCP "$src\client\src\pages\settings.tsx"               "$rem/client/src/pages/settings.tsx"
SSH "rm -f $rem/client/src/lib/auth-utils.ts"

# ── STEP 4: server root + middleware ──────────────────────────────────────────
Write-Host "`n====== STEP 4: server core ======" -ForegroundColor Yellow
SCP "$src\server\database-storage.ts"  "$rem/server/database-storage.ts"
SCP "$src\server\index.ts"             "$rem/server/index.ts"
SCP "$src\server\routes.ts"            "$rem/server/routes.ts"
SCP "$src\server\storage.ts"           "$rem/server/storage.ts"
SCP "$src\server\storage.types.ts"     "$rem/server/storage.types.ts"
SCP "$src\server\redis-client.ts"      "$rem/server/redis-client.ts"
SCP "$src\server\middleware\rbac.ts"   "$rem/server/middleware/rbac.ts"
SCP "$src\server\config\business-constants.ts" "$rem/server/config/business-constants.ts"
SCP "$src\server\types\vendor.d.ts"    "$rem/server/types/vendor.d.ts"

# ── STEP 5: server routes ─────────────────────────────────────────────────────
Write-Host "`n====== STEP 5: server routes ======" -ForegroundColor Yellow
SCP "$src\server\routes\admin.ts"                    "$rem/server/routes/admin.ts"
SCP "$src\server\routes\auth.ts"                     "$rem/server/routes/auth.ts"
SCP "$src\server\routes\conversation.routes.ts"      "$rem/server/routes/conversation.routes.ts"
SCP "$src\server\routes\customer.routes.ts"          "$rem/server/routes/customer.routes.ts"
SCP "$src\server\routes\health.ts"                   "$rem/server/routes/health.ts"
SCP "$src\server\routes\marquiz-debug.ts"            "$rem/server/routes/marquiz-debug.ts"
SCP "$src\server\routes\marquiz-webhook.ts"          "$rem/server/routes/marquiz-webhook.ts"
SCP "$src\server\routes\max-personal-webhook.ts"     "$rem/server/routes/max-personal-webhook.ts"
SCP "$src\server\routes\onboarding.routes.ts"        "$rem/server/routes/onboarding.routes.ts"
SCP "$src\server\routes\phase0.ts"                   "$rem/server/routes/phase0.ts"
SCP "$src\server\routes\product.routes.ts"           "$rem/server/routes/product.routes.ts"
SCP "$src\server\routes\tenant-config.routes.ts"     "$rem/server/routes/tenant-config.routes.ts"
SCP "$src\server\routes\channel-management.routes.ts"          "$rem/server/routes/channel-management.routes.ts"
SCP "$src\server\routes\escalation.routes.ts"                  "$rem/server/routes/escalation.routes.ts"
SCP "$src\server\routes\feature-flags.routes.ts"               "$rem/server/routes/feature-flags.routes.ts"
SCP "$src\server\routes\message.routes.ts"                     "$rem/server/routes/message.routes.ts"
SCP "$src\server\routes\settings.routes.ts"                    "$rem/server/routes/settings.routes.ts"
SCP "$src\server\routes\suggestion.routes.ts"                  "$rem/server/routes/suggestion.routes.ts"
SCP "$src\server\routes\test.routes.ts"                        "$rem/server/routes/test.routes.ts"
SCP "$src\server\routes\webhooks.routes.ts"                    "$rem/server/routes/webhooks.routes.ts"
SCP "$src\server\routes\channels\max.routes.ts"                "$rem/server/routes/channels/max.routes.ts"
SCP "$src\server\routes\channels\telegram-bot.routes.ts"       "$rem/server/routes/channels/telegram-bot.routes.ts"
SCP "$src\server\routes\channels\telegram-personal.routes.ts"  "$rem/server/routes/channels/telegram-personal.routes.ts"
SCP "$src\server\routes\channels\whatsapp-personal.routes.ts"  "$rem/server/routes/channels/whatsapp-personal.routes.ts"

# ── STEP 6: server services ───────────────────────────────────────────────────
Write-Host "`n====== STEP 6: server services ======" -ForegroundColor Yellow
SCP "$src\server\services\auth-service.ts"               "$rem/server/services/auth-service.ts"
SCP "$src\server\services\billing-service.ts"            "$rem/server/services/billing-service.ts"
SCP "$src\server\services\channel-adapter.ts"            "$rem/server/services/channel-adapter.ts"
SCP "$src\server\services\channel-adapter.types.ts"      "$rem/server/services/channel-adapter.types.ts"
SCP "$src\server\services\cryptobot-billing.ts"          "$rem/server/services/cryptobot-billing.ts"
SCP "$src\server\services\customer-summary-service.ts"   "$rem/server/services/customer-summary-service.ts"
SCP "$src\server\services\inbound-message-handler.ts"    "$rem/server/services/inbound-message-handler.ts"
SCP "$src\server\services\lost-deals-service.ts"         "$rem/server/services/lost-deals-service.ts"
SCP "$src\server\services\marquiz-lead-queue.ts"         "$rem/server/services/marquiz-lead-queue.ts"
SCP "$src\server\services\max-adapter.ts"                "$rem/server/services/max-adapter.ts"
SCP "$src\server\services\max-personal-adapter.ts"       "$rem/server/services/max-personal-adapter.ts"
SCP "$src\server\services\message-bus.ts"                "$rem/server/services/message-bus.ts"
SCP "$src\server\services\message-queue.ts"              "$rem/server/services/message-queue.ts"
SCP "$src\server\services\no-reply-check-queue.ts"       "$rem/server/services/no-reply-check-queue.ts"
SCP "$src\server\services\observability\metrics.ts"      "$rem/server/services/observability/metrics.ts"
SCP "$src\server\services\onboarding-service.ts"         "$rem/server/services/onboarding-service.ts"
SCP "$src\server\services\price-lookup-queue.ts"         "$rem/server/services/price-lookup-queue.ts"
SCP "$src\server\services\telegram-adapter.ts"           "$rem/server/services/telegram-adapter.ts"
SCP "$src\server\services\telegram-client-manager.ts"    "$rem/server/services/telegram-client-manager.ts"
SCP "$src\server\services\telegram-personal-adapter.ts"  "$rem/server/services/telegram-personal-adapter.ts"
SCP "$src\server\services\utils\dedup-cache.ts"          "$rem/server/services/utils/dedup-cache.ts"
SCP "$src\server\services\vehicle-lookup-queue.ts"       "$rem/server/services/vehicle-lookup-queue.ts"
SCP "$src\server\services\websocket-server.ts"           "$rem/server/services/websocket-server.ts"
SCP "$src\server\services\whatsapp-adapter.ts"           "$rem/server/services/whatsapp-adapter.ts"
SCP "$src\server\services\whatsapp-personal-adapter.ts"  "$rem/server/services/whatsapp-personal-adapter.ts"

# ── STEP 7: workers ───────────────────────────────────────────────────────────
Write-Host "`n====== STEP 7: workers ======" -ForegroundColor Yellow
SCP "$src\server\workers\marquiz-lead.worker.ts"    "$rem/server/workers/marquiz-lead.worker.ts"
SCP "$src\server\workers\message-send.worker.ts"    "$rem/server/workers/message-send.worker.ts"
SCP "$src\server\workers\no-reply-check.worker.ts"  "$rem/server/workers/no-reply-check.worker.ts"
SCP "$src\server\workers\price-lookup.worker.ts"    "$rem/server/workers/price-lookup.worker.ts"
SCP "$src\server\workers\vehicle-lookup.worker.ts"  "$rem/server/workers/vehicle-lookup.worker.ts"

# ── STEP 8: shared + migrations + root ────────────────────────────────────────
Write-Host "`n====== STEP 8: shared / migrations / root ======" -ForegroundColor Yellow
SCP "$src\shared\schema.ts"                              "$rem/shared/schema.ts"
SCP "$src\migrations\meta\_journal.json"                 "$rem/migrations/meta/_journal.json"
SCP "$src\migrations\0021_superb_toad_men.sql"           "$rem/migrations/0021_superb_toad_men.sql"
SCP "$src\migrations\0023_conversations_updated_at.sql"  "$rem/migrations/0023_conversations_updated_at.sql"
SCP "$src\migrations\0024_customer_is_blocked.sql"       "$rem/migrations/0024_customer_is_blocked.sql"
SCP "$src\migrations\meta\0021_snapshot.json"            "$rem/migrations/meta/0021_snapshot.json"
SCP "$src\package.json"             "$rem/package.json"
SCP "$src\package-lock.json"        "$rem/package-lock.json"
SCP "$src\tsconfig.json"            "$rem/tsconfig.json"
SCP "$src\ecosystem.config.cjs"     "$rem/ecosystem.config.cjs"
SCP "$src\script\build.ts"          "$rem/script/build.ts"
Write-Host "All files uploaded" -ForegroundColor Green

# ── STEP 9: npm install ────────────────────────────────────────────────────────
Write-Host "`n====== STEP 9: npm install ======" -ForegroundColor Yellow
SSH "cd $rem && npm install 2>&1 | tail -10"

# ── STEP 10: npm run build ─────────────────────────────────────────────────────
Write-Host "`n====== STEP 10: npm run build ======" -ForegroundColor Yellow
SSH "cd $rem && npm run build 2>&1 | tail -40"

# ── STEP 11: drizzle-kit push ──────────────────────────────────────────────────
Write-Host "`n====== STEP 11: drizzle-kit push ======" -ForegroundColor Yellow
SSH "cd $rem && npx drizzle-kit push --force 2>&1 | tail -20"

# ── STEP 12: pm2 restart ───────────────────────────────────────────────────────
Write-Host "`n====== STEP 12: pm2 restart ======" -ForegroundColor Yellow
SSH "cd $rem && pm2 restart ecosystem.config.cjs --update-env 2>&1 | tail -15"

# ── STEP 13: health check ──────────────────────────────────────────────────────
Write-Host "`n====== STEP 13: health check ======" -ForegroundColor Yellow
Start-Sleep 8
$hc = SSH "curl -s -o /dev/null -w 'HTTP_%{http_code}' https://aimessagehelper.online --max-time 20"
if ($hc -match 'HTTP_200') {
    Write-Host "`nDEPLOY SUCCESSFUL - HTTP 200" -ForegroundColor Green
} else {
    Write-Host "`nHTTP status: $hc" -ForegroundColor Yellow
    SSH "cd $rem && pm2 logs aisales --lines 30 --nostream 2>&1"
}
Write-Host "`n====== DONE ======" -ForegroundColor Green
