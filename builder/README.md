# Builder

Compile StructureLab on your OS. These helpers stay in the repo — they are not
copied into portable zips, installers, AppImages, or other shipped builds.

Installers for people who do not want to compile are published on GitHub **Releases**.

| OS | Command (from repo root) |
|----|--------------------------|
| Linux | `bash builder/linux/build.sh` |
| Windows **dev** (hot reload, no VS required) | `builder\windows\dev.bat` |
| Copy local palettes/icons/block textures into `minecraft/{version}/` | `npm run sync:assets` |
| Optional maintainer refresh of `public/entity-textures/` (not part of the app build) | `npm run sync:entity-textures` |
| Windows portable zip | `builder\windows\build-portable.bat` → `StructureLab-<version>-x64-portable.zip` |
| Windows installer (64-bit NSIS) | `builder\windows\build-installer.bat` → `StructureLab-<version>-x64-setup.exe` |
| macOS | `bash builder/macos/build.sh` |

Any OS (dev / official bundles):

```bash
npm install
npm run tauri build
```
