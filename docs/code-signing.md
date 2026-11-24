# Code signing for Windows

Status: **releases are not signed.** Nothing has been bought, applied for or
configured. Sources were read on 2026-11-25; prices and rules change, so open
the link again before paying.

Scope: an individual developer in Thailand, an Apache-2.0 project on GitHub, and
an NSIS `.exe` distributed through GitHub Releases.

## Summary

| Question | Answer |
| --- | --- |
| Can signing remove the SmartScreen warning for the first 5–10 testers? | No option outside the Microsoft Store does that. |
| Recommended option | **Certum Open Source Code Signing in the Cloud**, signed by the owner at release time. |
| When | Before a wider public release. The first tester round can run unsigned. |
| Cost | €49 for one year ([Certum shop](https://shop.certum.eu/open-source-code-signing-on-simplysign.html)). |
| Main drawbacks | The owner's legal name becomes public in the certificate, signing is a manual step, and commercial distribution is not allowed. |
| Apply again later | SignPath Foundation, once Lomra has visible users. |

## What signing changes in Windows

- Microsoft says a newly signed file still shows a SmartScreen warning until
  reputation builds, and the warning then shows the verified publisher. "There
  is no exact threshold, but it can take several weeks and hundreds of clean
  installs." An unsigned file starts from zero with every version; a signed one
  can inherit its publisher's reputation.
  ([SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation))
- EV certificates have not bypassed SmartScreen since 2024, so paying for EV to
  avoid the warning is not justified.
  ([Code signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options))
- Smart App Control, when it is on, blocks executables that are neither signed
  by a trusted CA nor known to Microsoft, including files that were not
  downloaded.
  ([Smart App Control](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/overview))
- A publicly trusted certificate issued since 2026-03-01 lasts at most 460 days,
  so every option below means renewing about once a year.
  ([CA/Browser Forum code signing requirements](https://cabforum.org/working-groups/code-signing/requirements/))

## Options

| Option | Open to an individual in Thailand? | Cost | CI signing | Name shown | SmartScreen |
| --- | --- | --- | --- | --- | --- |
| Azure Artifact Signing (formerly Trusted Signing) | **No.** Individuals must be in the USA or Canada. | $9.99/month | Yes | Legal name | Builds over time |
| SignPath Foundation | Yes, by project, but Lomra probably does not qualify yet. | Free | Yes, with manual approval of each release | SignPath Foundation | Builds over time |
| **Certum Open Source, cloud** | Yes, by its published rules; Thai documents not confirmed. | €49/year | No official unattended flow found | "Open Source Developer" + legal name | Builds over time |
| Certum Standard, cloud | Same as above | from €209 | Same as above | Legal name | Builds over time |
| SSL.com IV + eSigner | Probably; Thailand is not named in the guide. | $129/year + $180/year for 240 signings | Yes, documented | Legal name | Builds over time |
| Microsoft Store (MSIX) | Microsoft lists it as worldwide | Free | Store signs | Store listing | No warning |
| Stay unsigned | Yes | Free | – | "Unknown publisher" | Warning on every version |

### Azure Artifact Signing: not available

- "Individual developers must be located in the United States or Canada."
  Organizations are accepted from a longer list that does not include Thailand.
  ([Quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart))
- The [Windows developer guide](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)
  gives a shorter organization list than the quickstart. They agree on
  individuals.
- Basic tier price: [Azure retail price API](https://prices.azure.com/api/retail/prices?$filter=productName%20eq%20%27Trusted%20Signing%27).
- Re-check if the region list changes. electron-builder already supports it
  (`win.azureSignOptions`).

### SignPath Foundation: later

The certificate belongs to SignPath Foundation, so no personal name is
published. Conditions: [signpath.org/terms](https://signpath.org/terms).

| Condition | Lomra today |
| --- | --- |
| OSI license, no commercial dual licensing, for all components | Apache-2.0. The JavaScript packages in the packaged app declare MIT, Apache-2.0, BSD-3-Clause, ISC, MIT/CC0 and, for `sharp`'s libvips, LGPL-3.0-or-later. |
| No proprietary code, except system libraries | **Needs a ruling.** `onnxruntime-node` bundles Microsoft's `DirectML.dll`, distributed under [Microsoft license terms](https://www.nuget.org/packages/Microsoft.AI.DirectML/1.15.4/License), and `dxil.dll`; Electron bundles `d3dcompiler_47.dll`. They may count as system libraries. Ask, do not assume. |
| Sign only your own binaries | Possible: sign `Lomra.exe`, the uninstaller and the installer only. electron-builder would also re-sign Microsoft's `OpenConsole.exe` and its own `elevate.exe`; see the config below. |
| Already released, maintained and documented | Yes. Seven releases, README and usage guide. |
| Verifiable reputation: "we cannot sign binaries based on source code that nobody knows" | **Not met.** Public repository since 2026-11-10, 2 stars, 0 forks, 2–4 downloads per release. |
| Built in a verifiable way; every release approved by hand | CI runs on GitHub-hosted runners. Approval would be a new step. |
| MFA on GitHub and SignPath | The owner must confirm. |
| "Code signing policy" section and privacy statement on the home page | Missing. It needs the data statements in [testing/README.md](testing/README.md#what-leaves-the-computer). |
| Announce system changes, provide uninstall | Yes. Engines, models and Ollama are installed only after a dialog, and NSIS adds an uninstaller. |
| No features that "circumvent security measures" | **Possible objection.** Lomra can drive a signed-in ChatGPT or Gemini web session. Describe it openly. |

The bundled engines are not the whole picture. Lomra also downloads
stable-diffusion.cpp, FFmpeg (LGPL build), Python, CUDA PyTorch, and model
weights under licenses that are not OSI licenses (Stability AI Community,
CreativeML OpenRAIL-M, Tencent Hunyuan Community, which excludes the EU, UK and
South Korea). They are not inside the installer and start only after consent,
but a reviewer can reasonably ask. State it in the application.

Several projects report being declined for low visibility in recent months and
invited to reapply: [EasyTab](https://github.com/AdamSellin/EasyTab/pull/64),
[Skrog](https://github.com/wslkit/skrog/pull/357),
[screenpet](https://github.com/OmkarPalika/screenpet/pull/6). These are the
maintainers' own accounts, not a SignPath statement.

### Certum Open Source in the Cloud: recommended

Requirements ([required documents](https://support.certum.eu/en/code-signing-required-documents/),
[product page](https://shop.certum.eu/open-source-code-signing-on-simplysign.html)):

| Requirement | Lomra / owner today |
| --- | --- |
| An individual; the certificate says "Open Source Developer" plus the person's name | Fits. The legal name becomes public. |
| Identity check (automatic, notary, registration point, or photos holding an ID card, passport or driving license) | Certum says the automatic check serves [180 countries](https://www.certum.eu/en/news/automatic-idenity-verification-in-certum/); Thailand is not listed by name. A passport avoids a Thai-script ID. |
| A utility bill issued to the subscriber | **Unconfirmed** whether a Thai-language bill is accepted without a translation. |
| A public project that "indicates clearly the subscriber's relationship with the project" | **Not met.** The repository, `NOTICE` and `package.json` name only the project. The owner has to make the link public. |
| Software must not be distributed commercially, or the certificate is revoked | Fits while Lomra is free. A paid version, paid support bundle or store sale needs a different certificate first. |
| Phone with SimplySign, computer with SimplySign Desktop | The sign-in code comes from the phone. |

The published conditions do not mention third-party components, so the bundled
Microsoft DLLs and downloaded models are not an obvious conflict. They were read
from the product and document pages, not from the full CPS.

Why this one: it is the cheapest option whose published rules an individual
outside the USA and Canada can meet, and the project qualifies now. Why manual:
[Certum's instructions](https://files.certum.eu/documents/manual_en/CS-Code_Signing_in_the_Cloud_Signtool_jarsigner_signing.pdf)
sign in with a one-time code from the phone. Community tools automate that by
storing the one-time-code seed as a secret. Anyone who reads that secret can
sign as the owner, so do not use them.

### SSL.com IV + eSigner: the paid CI alternative

- [IV certificate](https://www.ssl.com/products/software-integrity/code-signing/iv/):
  $129 for one year. [eSigner tier 1](https://www.ssl.com/guide/esigner-pricing-for-code-signing/):
  $20/month for 20 signings or $180/year for 240.
- [Identity check](https://www.ssl.com/guide/identity-validation-for-ssl-com-certificates-a-complete-guide/):
  passport, ID card or driver's license for "Asia-Pacific (… and others)";
  Thailand is not named.
- [GitHub Actions guide](https://www.ssl.com/how-to/cloud-code-signing-integration-with-github-actions/).
  It stores the account password and one-time-code secret in GitHub, so it needs
  the protected environment described below.
- Choose it if a manual step per release becomes too slow, or if Lomra turns
  commercial.

### Microsoft Store

The only option with no warning and no certificate.
[Individual accounts are free](https://learn.microsoft.com/en-us/windows/apps/publish/partner-center/open-a-developer-account),
but Lomra would need an MSIX package, Store policy review of its engine
downloads, and a build without the NSIS updater. That is a product change, not a
signing step.

## Steps for the owner (Certum)

1. Decide three things: publishing your legal name in every release, staying
   non-commercial, and doing a manual step per release.
2. Make your connection to the project public where Certum can find it.
3. Ask Certum support before paying: is a Thai passport accepted by the
   automatic check, and is a Thai utility bill accepted or must it be translated?
4. Buy the certificate, activate it, and install SimplySign on the phone and
   SimplySign Desktop on the PC. Turn on MFA for GitHub.
5. Apply the release change below, then try it on a new patch version.
6. Put the renewal date in a calendar. The signature needs a timestamp so old
   installers stay valid after the certificate expires.

### Release change (not applied; it cannot be tested without the certificate)

Keep the CI build, create the release as a draft, and publish it after signing.
In the `release` job of `.github/workflows/ci.yml`, replace the last two lines
with:

```yaml
          gh release create "$GITHUB_REF_NAME" --draft --verify-tag --generate-notes
```

Then, on the owner's PC with SimplySign connected:

```powershell
$version = '0.1.0'
$file = "release\Lomra-$version-windows-x64.exe"
gh run download <run-id> -n windows-installer -D release
signtool sign /sha1 <certificate thumbprint> /tr http://time.certum.pl /td sha256 /fd sha256 /v $file
signtool verify /pa /all /v $file
.\apps\desktop\scripts\check-signature.ps1 -Path $file -SigningConfigured true
gh release upload "v$version" $file
gh release view "v$version" --json assets   # the digest must equal the SHA-256 printed above
gh release edit "v$version" --draft=false --latest
```

Leave the `WINDOWS_SIGNING` repository variable **unset** in this flow: the file
CI builds is unsigned by design, and the local check is the gate.

This signs the installer, which is the file SmartScreen looks at. `Lomra.exe`
and the uninstaller inside it stay unsigned. Signing them means packaging on the
machine that holds the certificate, with this electron-builder config
(`apps/desktop/electron-builder.signed.cjs`):

```js
const { build } = require('./package.json');
module.exports = {
  ...build,
  forceCodeSigning: true,
  nsis: { ...build.nsis, packElevateHelper: false }, // third-party elevate.exe, unused by a per-user install
  win: {
    ...build.win,
    signExts: ['!OpenConsole.exe'], // already signed by Microsoft
    signtoolOptions: {
      certificateSha1: process.env.LOMRA_CERT_SHA1,
      signingHashAlgorithms: ['sha256'],
      rfc3161TimeStampServer: 'http://time.certum.pl',
    },
  },
};
```

```sh
bun run --cwd apps/desktop electron-builder --win nsis --x64 --publish never --config electron-builder.signed.cjs
```

Keep the output folder at `dist`. `win.files` holds only exclusions, so
electron-builder packs other folders of `apps/desktop` too, and an output folder
elsewhere leaves an old `dist` to be packed into the app.

Even then, `ffmpeg.dll`, `electron_wer.dll`, `dxcompiler.dll`, `vulkan-1.dll`,
`vk_swiftshader.dll`, the `sharp` and `node-pty` modules, and every downloaded
engine are unsigned upstream files. Do not promise that Smart App Control will
let Lomra run.

### If a CI provider is used instead (SignPath or SSL.com)

1. Create a GitHub environment `release-signing` with a required reviewer and a
   tag rule `v*`, and put the provider's secrets there only.
   ([Environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments))
2. Sign in a separate job so `validate`, which also runs for pull requests,
   never sees a secret.
3. Move the **Check installer signature** step into that job, then set the
   repository variable `WINDOWS_SIGNING` to `true`.

SignPath shape, following its
[GitHub guide](https://docs.signpath.io/trusted-build-systems/github). Not
tested; slugs come from the SignPath account:

```yaml
  # validate: give the upload step `id: installer` and add
  #   outputs: { artifact-id: "${{ steps.installer.outputs.artifact-id }}", version: "${{ steps.version.outputs.version }}" }
  sign:
    if: github.event_name == 'push' && github.ref_type == 'tag' && github.repository == 'Nxdus/lomra-app'
    needs: validate
    runs-on: windows-latest
    environment: release-signing
    permissions:
      actions: read
      contents: read
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6
        with:
          persist-credentials: false
      - uses: SignPath/github-action-submit-signing-request@a2c5b60d9c75f073142b653c354b632eedce097b # v3.2
        with:
          api-token: ${{ secrets.SIGNPATH_API_TOKEN }}
          organization-id: ${{ vars.SIGNPATH_ORGANIZATION_ID }}
          project-slug: lomra-app
          signing-policy-slug: release-signing
          github-artifact-id: ${{ needs.validate.outputs.artifact-id }}
          output-artifact-directory: signed
      - name: Check installer signature
        env:
          WINDOWS_SIGNING: ${{ vars.WINDOWS_SIGNING }}
        run: ./apps/desktop/scripts/check-signature.ps1 -Path signed/Lomra-${{ needs.validate.outputs.version }}-windows-x64.exe
      - uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7
        with:
          name: windows-installer-signed
          path: signed/*.exe
          if-no-files-found: error
          compression-level: 0
  # release: `needs: sign`, and download `windows-installer-signed`
```

## What is in place now

- `apps/desktop/scripts/check-signature.ps1` prints the status, signer, timestamp
  and SHA-256 of a file. CI runs it on tag builds after packaging and adds the
  result to the run summary.
- It fails only when `WINDOWS_SIGNING` is `true` and the embedded signature is
  missing or invalid. Unset or `false` reports and passes. Any other value is an
  error, so a typing mistake cannot switch the check off.
- A catalog signature is not accepted because it does not travel with the file.
  A missing timestamp is a warning.
- CI holds no signing secret and no signing step. Packaging runs only for tags,
  so pull requests never reach it, and a fork has no configuration to sign with.

## The in-app updater and signed files

- Signing changes the bytes, so it must happen before the upload. GitHub
  computes an asset's digest
  [at upload time](https://github.blog/changelog/2025-06-03-releases-now-expose-digests-for-release-assets/),
  and `release` needs `validate`, so a file signed before `gh release create` or
  `gh release upload` always matches its digest.
- Never replace the asset of a published release. Users who cached the old check
  result would fail verification until the next check, and the old file may
  still be downloading.
- The updater reads `/releases/latest`, which does not return drafts, so a draft
  waiting for a signature is not offered to anyone.
- Checked on 2026-11-25 with the real `updates.mjs` and a small NSIS installer
  signed with a throwaway certificate: the digest of the signed file verified,
  the saved bytes were identical, and the installer started with
  `/S --updated --force-run`. With the digest of the unsigned file the install
  was refused.
- `updates.mjs` does not check the signer. The trust anchor stays the GitHub
  digest over HTTPS. Pinning the publisher would be a separate change once a
  certificate exists.

## Still uncertain

- Certum: Thai documents, the final price with tax, and the full CPS wording.
- SSL.com: whether Thai identity documents pass its check.
- SignPath: whether `DirectML.dll` and similar files count as system libraries,
  and whether web-session automation is acceptable.
- How fast reputation builds at Lomra's download volume, and whether a
  certificate renewal keeps it. Microsoft gives no threshold.
- A real signed Lomra installer has not been installed or updated. Only a test
  certificate and a test installer were used.
