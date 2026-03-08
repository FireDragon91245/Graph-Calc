param(
  [switch]$Force
)

$certDir = Join-Path $PSScriptRoot "..\certs"
$certPath = Join-Path $certDir "localhost-cert.pem"
$keyPath = Join-Path $certDir "localhost-key.pem"

if (-not $Force -and (Test-Path $certPath) -and (Test-Path $keyPath)) {
  return
}

New-Item -ItemType Directory -Force -Path $certDir | Out-Null

$rsa = [System.Security.Cryptography.RSA]::Create(2048)
try {
  $subject = [System.Security.Cryptography.X509Certificates.X500DistinguishedName]::new("CN=localhost")
  $request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new(
    $subject,
    $rsa,
    [System.Security.Cryptography.HashAlgorithmName]::SHA256,
    [System.Security.Cryptography.RSASignaturePadding]::Pkcs1
  )

  $sanBuilder = [System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
  $sanBuilder.AddDnsName("localhost")
  $sanBuilder.AddIpAddress([System.Net.IPAddress]::Parse("127.0.0.1"))

  $request.CertificateExtensions.Add($sanBuilder.Build())
  $request.CertificateExtensions.Add(
    [System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false, $false, 0, $true)
  )
  $request.CertificateExtensions.Add(
    [System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new(
      [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature -bor
      [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyEncipherment,
      $true
    )
  )
  $request.CertificateExtensions.Add(
    [System.Security.Cryptography.X509Certificates.X509SubjectKeyIdentifierExtension]::new($request.PublicKey, $false)
  )

  $notBefore = (Get-Date).AddDays(-1)
  $notAfter = (Get-Date).AddYears(3)
  $certificate = $request.CreateSelfSigned($notBefore, $notAfter)

  [System.IO.File]::WriteAllText($certPath, $certificate.ExportCertificatePem(), [System.Text.UTF8Encoding]::new($false))
  [System.IO.File]::WriteAllText($keyPath, $rsa.ExportPkcs8PrivateKeyPem(), [System.Text.UTF8Encoding]::new($false))
}
finally {
  if ($null -ne $rsa) {
    $rsa.Dispose()
  }
}