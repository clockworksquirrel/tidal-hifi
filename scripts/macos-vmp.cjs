const { spawn } = require("node:child_process");
const { access } = require("node:fs/promises");
const path = require("node:path");

function runEvs(command, packageDir, productName) {
  const python = process.env.TIDAL_HIFI_EVS_PYTHON || "python3";
  const args = [
    "-m",
    "castlabs_evs.vmp",
    "--no-ask",
    command,
    "--streaming",
    "--name-hint",
    productName,
    packageDir,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(python, args, { stdio: "inherit", shell: false });
    child.once("error", (error) => {
      reject(
        new Error(
          "Could not start the EVS client. Install castlabs-evs in a Python environment " +
            "and set TIDAL_HIFI_EVS_PYTHON to its Python executable.",
          { cause: error },
        ),
      );
    });
    child.once("close", (code, signal) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(`EVS ${command} failed (${signal || `exit ${code}`}). Packaging stopped.`),
        );
      }
    });
  });
}

async function processApp(appPath, sign) {
  const absoluteApp = path.resolve(appPath);
  if (!absoluteApp.endsWith(".app")) throw new Error("Provide the path to a macOS .app bundle.");
  const productName = path.basename(absoluteApp, ".app");
  // EVS treats name-hint as a glob. An exact name keeps it on the selected app.
  if (/[*?[\]]/.test(productName))
    throw new Error("The app name must not contain glob characters.");
  await access(
    path.join(
      absoluteApp,
      "Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework",
    ),
  );
  const packageDir = path.dirname(absoluteApp);
  if (sign) await runEvs("sign-pkg", packageDir, productName);
  await runEvs("verify-pkg", packageDir, productName);
}

// electron-builder runs afterPack before Apple signing and archive creation.
// Select this hook with electron-builder.mac-vmp.yml after EVS account setup.
module.exports = async (context) => {
  if (context.electronPlatformName !== "darwin") return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  await processApp(appPath, true);
};

if (require.main === module) {
  const [command, appPath, ...extra] = process.argv.slice(2);
  if (!["verify", "sign"].includes(command) || !appPath || extra.length) {
    console.error("Usage: node scripts/macos-vmp.cjs <verify|sign> /path/to/tidal-hifi.app");
    process.exitCode = 1;
  } else {
    processApp(appPath, command === "sign").catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
