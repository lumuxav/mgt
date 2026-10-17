# Sidebar scrolling and downloadable apps — 17 October 2026

## Sidebar

The fixed desktop sidebar's navigation used `flex: 1` with the default minimum content height and no vertical overflow container. With many modules, links extended below the viewport and the menu could not scroll.

The navigation now has a zero minimum height, vertical scrolling, a stable scrollbar gutter and contained overscroll. The sidebar uses the viewport height; brand and signed-in account remain visible. The navigation has an accessible label and keyboard focus, so arrow/Page Down keys and focused links can scroll it. Mobile navigation retains its existing scrollable sheet.

## App releases

A dedicated Electron desktop shell packages the production MGT application for Windows x64, macOS arm64/x64 and Linux x64. It preserves the MGT icon, isolates remote content from Node.js, uses the renderer sandbox, restricts navigation to the exact production HTTPS origin, rejects local-file/custom-protocol popups, requests confirmation for external HTTPS links and camera use, and provides recovery/retry when the connection fails.

The app release workflow coordinates desktop and Android builds from one commit. A complete release receives a versioned tag, SHA-256 checksums and GitHub's Latest designation. The public install guide links to the latest release; repository access is still required for this private repository. Android test signing and absent desktop publisher/notarization certificates are stated in release notes. iOS unsigned simulator builds are not represented as installable device apps.

No database schema or records are changed by this update.

## Verification record

Desktop policy regressions cover origin spoofing, unsafe URL protocols, subframe camera requests and microphone denial. A real Electron smoke test in Linux CI covers launch, renderer isolation, internal navigation, local-file/popup blocking, connection recovery and retry using synthetic pages. Browser checks cover the full navigation at short desktop heights, independent wheel/keyboard scrolling and mobile menu scrolling. 
- A clean local Next.js production build passes (58 pages).
- 41 existing JavaScript regression tests pass.
- 3 desktop URL/permission policy tests pass.
- Browser fixtures pass at 1366×640, 1024×400 and 1440×900: wheel and Page Down scroll the sidebar independently; the final menu link and account card are visible.
- Mobile fixture at 390×640 can scroll the module sheet to its last link.
- Changed React components pass ESLint.
- Final pull-request checks passed: [web build and 41 tests](https://github.com/lumuxav/mgt/actions/runs/39077923959), [Android](https://github.com/lumuxav/mgt/actions/runs/39077923955), and [all desktop targets plus the Linux Electron smoke test](https://github.com/lumuxav/mgt/actions/runs/39077923961).
- The same four browser viewport checks passed against the deployed production frontend using synthetic authentication/data fixtures. They verified independent wheel/Page Down scrolling, the last menu link, visible account card, mobile sheet scrolling and the live latest-release download link. These are UI checks, not real-customer transaction tests.

## Completed rollout

[PR #2](https://github.com/lumuxav/mgt/pull/2) was merged as `91e9af17662cd769112b35ec1f2229118ac858bd`. [Vercel production](https://vercel.com/safe-heaven1/mgt/ABqQ7dc95JbQW1eywW7zjJV9opMk) succeeded. `/api/health` returned HTTP 200 with release `91e9af17662c`; `/install` returned HTTP 200 and the new GitHub latest-release link.

[Release MGT Apps run 39078141211](https://github.com/lumuxav/mgt/actions/runs/39078141211) completed successfully and published **[MGT Business Suite 1.1.1](https://github.com/lumuxav/mgt/releases/tag/mgt-v1.1.1)** on 17 October 2026 at 23:16 UTC. GitHub `/releases/latest` resolves to this release, and its tag points to the merge commit above. All six expected assets have state `uploaded` and a GitHub SHA-256 digest:

| Asset | Bytes |
| --- | ---: |
| MGT-Business-Suite-Test.apk | 4,619,145 |
| MGT-Business-Suite-Windows-x64.exe | 110,685,794 |
| MGT-Business-Suite-macOS-arm64.dmg | 126,853,818 |
| MGT-Business-Suite-macOS-x64.dmg | 133,662,296 |
| MGT-Business-Suite-Linux-x64.AppImage | 125,310,478 |
| SHA256SUMS.txt | 499 |

Android production signing steps were skipped because the signing configuration remains incomplete. The published APK is test-signed. Windows is unsigned; macOS has an ad-hoc signature without notarization. iOS physical-device packages remain unavailable without Apple signing. Windows/macOS installer compilation and the Linux Electron runtime smoke test passed; physical-device installation and camera/printer hardware acceptance remain separate from these checks. Temporary release artifacts expire after one day; GitHub release assets remain available.
