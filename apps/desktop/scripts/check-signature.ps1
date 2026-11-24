# Reports the Authenticode status of a built installer. It fails only when signing is configured
# (WINDOWS_SIGNING is `true`) and the embedded signature is missing or invalid. See docs/code-signing.md.
param(
  [Parameter(Mandatory)] [string] $Path,
  [string] $SigningConfigured = $env:WINDOWS_SIGNING
)
$ErrorActionPreference = 'Stop'

$setting = "$SigningConfigured".Trim()
if ($setting -notin '', 'true', 'false') { throw "WINDOWS_SIGNING must be true, false or unset, not '$setting'." }
$configured = $setting -eq 'true'

$file = Get-Item -LiteralPath $Path
$signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
# A catalog signature lives in this computer's Windows folder and does not travel with the file.
$embedded = $signature.SignatureType -eq 'Authenticode'
$valid = $embedded -and $signature.Status -eq 'Valid'
$status = if ($signature.Status -eq 'Valid' -and -not $embedded) { 'NotSigned (catalog only)' } else { "$($signature.Status)" }

$report = @(
  "File: $($file.Name)"
  "SHA-256: $((Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant())"
  "Authenticode status: $status"
  "Signer: $(if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { 'none' })"
  "Timestamp: $(if ($signature.TimeStamperCertificate) { 'present' } else { 'none' })"
  "Signing configured: $configured"
)
$report | Write-Output
if ($env:GITHUB_STEP_SUMMARY) {
  (@('### Installer signature', '') + ($report | ForEach-Object { "- $_" })) | Out-File -LiteralPath $env:GITHUB_STEP_SUMMARY -Append -Encoding utf8
}

if ($valid) {
  if (-not $signature.TimeStamperCertificate) { Write-Output '::warning::The installer signature has no timestamp, so it stops being valid when the certificate expires.' }
  exit 0
}
if ($configured) {
  Write-Output "::error::Signing is configured but the installer signature is $status."
  exit 1
}
if ($signature.Status -eq 'NotSigned') { Write-Output '::notice::The installer is not signed. Signing is not configured, so this is expected.' }
else { Write-Output "::warning::Signing is not configured, but the installer signature is $status." }
exit 0
