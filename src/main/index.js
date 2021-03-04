/* eslint-disable prefer-destructuring */
/* eslint-disable no-console */
/* eslint-disable prefer-promise-reject-errors */
/* eslint-disable no-param-reassign */
/* eslint-disable no-unused-vars */
/* eslint-disable operator-assignment */
/* eslint-disable prefer-template */
/* eslint-disable no-use-before-define */
/* eslint-disable no-unused-expressions */
/* eslint-disable quotes */
import { app, BrowserWindow, ipcMain, screen } from 'electron';
import * as path from 'path';
import { format as formatUrl } from 'url';
import fs from 'fs';
import os from 'os';
import mime from 'mime-types';
import { spawn } from 'child_process';
import { setConfig, updateConfig } from '../utils/setConfig';
import setTranslate from '../utils/setTranslate';
import setPAR from '../utils/setPAR';

require('events').EventEmitter.defaultMaxListeners = Infinity;

/* const FileType = require('file-type'); */
const request = require('request');
/* const fetch = require('node-fetch'); */

const isDevelopment = process.env.NODE_ENV !== 'production';

let mainWindow;
let pythonPath;
let outputPath;

async function createMainWindow() {
  const factor = screen.getPrimaryDisplay().scaleFactor;
  let minWidth = 1080;
  let minHeight = 680;
  if (factor === 1) {
    minWidth = 1080;
    minHeight = 800;
  } else if (factor >= 1.25 && factor < 1.5) {
    minWidth = 865;
    minHeight = 700;
  } else if (factor >= 1.5) {
    minWidth = 740;
    minHeight = 650;
  }

  process.setMaxListeners(Infinity);

  const window = new BrowserWindow({
    minWidth,
    minHeight,
    title: 'JHove 2020',
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      nodeIntegration: true,
      enableRemoteModule: true,
      zoomFactor: 1.0 / factor,
    },
  });

  window._id = 'main';
  global.window = window;
  if (isDevelopment) {
    window.webContents.openDevTools();
  }

  if (isDevelopment) {
    window.loadURL(`http://localhost:${process.env.ELECTRON_WEBPACK_WDS_PORT}`);
  } else {
    window.loadURL(
      formatUrl({
        pathname: path.join(__dirname, 'index.html'),
        protocol: 'file',
        slashes: true,
      }),
    );
  }

  window.on('closed', () => {
    mainWindow = null;
  });

  window.webContents.on('devtools-opened', () => {
    window.focus();
    setImmediate(() => {
      window.focus();
    });
  });

  const translate = await setTranslate(isDevelopment);
  const config = await setConfig(isDevelopment);
  pythonPath = config.pythonPath;
  const PAR = await setPAR(isDevelopment);
  window.webContents.on('did-finish-load', () => {
    window.webContents.send('translate', translate);
    window.webContents.send('config', config);
    window.webContents.send('PAR', PAR);
  });

  return window;
}

/* app.on('before-quit', () => {
  updateConfig(isDevelopment, outputPath);
}); */

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    mainWindow = createMainWindow();
  }
});

const download = (url, dest) => new Promise((resolve, reject) => {
  const file = fs.createWriteStream(dest);

  const sendReq = request.get(url);

  sendReq.on('response', response => {
    if (response.statusCode === 200) {
      sendReq.pipe(file);
    } else {
      file.close();
      fs.unlink(dest, () => {});
      reject(`Server responded with ${response.statusCode}: ${response.statusMessage}`);
    }
  });

  sendReq.on('error', err => {
    file.close();
    fs.unlink(dest, () => {});
    reject(err.message);
  });

  file.on('finish', () => {
    resolve();
  });

  file.on('error', err => {
    file.close();
    console.log(err);

    if (err.code === 'EEXIST') {
      reject('File already exists');
    } else {
      fs.unlink(dest, () => {});
      reject(err.message);
    }
  });
});

ipcMain.on('check-mime-type', async (event, arg) => {
  const type = mime.lookup(arg);
  event.sender.send('receive-mime-type', type);
});

app.on('ready', () => {
  mainWindow = createMainWindow();
});

const runJobFailed = (error, event) => {
  const win = new BrowserWindow({
    minWidth: 1037,
    minHeight: 500,
    title: 'JHove 2020',
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      nodeIntegration: true,
      enableRemoteModule: true,
    },
  });
  win._id = 'jobFailed';

  win.webContents.once('did-finish-load', async () => {
    const translate = await setTranslate(isDevelopment);
    win.webContents.send('translate', translate);
    win.webContents.send('receive-err', { report: error });
  });

  if (isDevelopment) {
    win.webContents.openDevTools();
  }

  if (isDevelopment) {
    win.loadURL(`http://localhost:${process.env.ELECTRON_WEBPACK_WDS_PORT}`);
  } else {
    win.loadURL(
      formatUrl({
        pathname: path.join(__dirname, 'index.html'),
        protocol: 'file',
        slashes: true,
      }),
    );
  }
};

const getDateString = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hours = `${date.getHours()}`.padStart(2, '0');
  const mins = `${date.getMinutes()}`.padStart(2, '0');
  const sec = `${date.getSeconds()}`.padStart(2, '0');
  return `${year}${month}${day}${hours}${mins}${sec}`;
};

const runScript = (tool, filePath, optionArr, outFol, event) => {
  let shieldedPath = filePath.split('');
  shieldedPath.unshift('"');
  shieldedPath.push('"');
  shieldedPath = shieldedPath.join('');
  let reportDate = '';
  let reportText = '';
  let errorText = '';
  let dest = '';
  const scriptPath = isDevelopment
    ? path.join(__dirname, '..', '..', 'libs', tool.toolLabel)
    : path.join(__dirname, '..', 'libs', tool.toolLabel);
  if (tool.toolLabel.split('.')[tool.toolLabel.split('.').length - 1] === 'py') {
    const python = (os.platform() === 'linux') ? 'python3' : 'python';
    reportDate = spawn(python, [
      scriptPath,
      ...optionArr,
      filePath,
    ]);
  } else {
    reportDate = spawn(scriptPath, [
      ...optionArr,
      filePath,
    ]);
  }

  reportDate.stdout.on('data', (data) => {
    data ? reportText += data.toString() : null;
    dest = path.join(outFol, `${path.basename(filePath)}-${tool.id.name}_${getDateString()}.txt`);
  });
  reportDate.stdout.on('end', (data) => {
    fs.writeFile(dest, reportText, error => {
      if (error) {
        event.sender.send('receive-load', false);
        error.message !== `ENOENT: no such file or directory, open ''`
          ? runJobFailed(error.message)
          : runJobFailed(errorText);
        return;
      }
      const win = new BrowserWindow({
        minWidth: 1037,
        minHeight: 700,
        title: 'JHove 2020',
        frame: false,
        titleBarStyle: 'hidden',
        webPreferences: {
          nodeIntegration: true,
          enableRemoteModule: true,
        },
      });
      win._id = 'report';

      win.webContents.once('did-finish-load', async () => {
        const translate = await setTranslate(isDevelopment);
        win.webContents.send('translate', translate);
        win.webContents.send('receiver', { report: reportText, path: dest });
        event.sender.send('receive-load', false);
      });

      if (isDevelopment) {
        win.webContents.openDevTools();
      }

      if (isDevelopment) {
        win.loadURL(`http://localhost:${process.env.ELECTRON_WEBPACK_WDS_PORT}`);
      } else {
        win.loadURL(
          formatUrl({
            pathname: path.join(__dirname, 'index.html'),
            protocol: 'file',
            slashes: true,
          }),
        );
      }
    });
  });
  reportDate.stderr.on('data', (data) => {
    console.error(data.toString());
    errorText += data.toString();
    event.sender.send('receive-load', false);
  });
  reportDate.on('error', (err) => {
    errorText += err.toString();
  });

  outputPath = outFol;
};

ipcMain.on('execute-file-action', (event, arg) => {
  if (arg.fileOrigin === 'url') {
    console.log(os.tmpdir());
    arg.filePath = path.join(os.tmpdir(), `${getDateString()}-${arg.fileName}`);
    try {
      download(arg.path, arg.filePath)
        .then(() => runScript(arg.tool, arg.filePath, arg.option.value, arg.outputFolder, event))
        .catch(err => {
          event.sender.send('receive-load', false);
          runJobFailed(err);
          console.log(err);
        });
    } catch (err) {
      event.sender.send('receive-load', false);
      runJobFailed(err.message);
      console.log(err);
    }
  } else {
    arg.filePath = arg.path;
    runScript(arg.tool, arg.filePath, arg.option.value, arg.outputFolder, event);
  }
  updateConfig(isDevelopment, outputPath);
});
