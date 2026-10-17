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
- Native builds, Electron runtime smoke test and publication are verified by the associated GitHub workflow runs; final outcomes will be recorded after execution.
