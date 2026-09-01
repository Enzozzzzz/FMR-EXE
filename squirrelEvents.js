const path = require('path');
const fs = require('fs');
const childProcess = require('child_process');

function handleSquirrelEvent() {
  if (process.argv.length === 1) {
    return false;
  }

  const appFolder = path.resolve(process.execPath, '..');
  const rootFolder = path.resolve(appFolder, '..');
  const updateExe = path.resolve(path.join(rootFolder, 'Update.exe'));
  const exeName = path.basename(process.execPath);

  const target = path.join(process.env.USERPROFILE, 'Desktop', `${exeName}.lnk`);

  const spawn = function(command, args) {
    let spawnedProcess;

    try {
      spawnedProcess = childProcess.spawn(command, args, { detached: true });
    } catch (error) {}

    return spawnedProcess;
  };

  const spawnUpdate = function(args) {
    return spawn(updateExe, args);
  };

  switch (process.argv[1]) {
    case '--squirrel-install':
    case '--squirrel-updated':
      // Crée le raccourci sur le bureau
      spawnUpdate(['--createShortcut', exeName, '--shortcut-locations', 'Desktop']);
      return true;

    case '--squirrel-uninstall':
      // Supprime le raccourci
      spawnUpdate(['--removeShortcut', exeName]);
      return true;

    case '--squirrel-obsolete':
      return true;
  }

  return false;
}

module.exports = handleSquirrelEvent;
