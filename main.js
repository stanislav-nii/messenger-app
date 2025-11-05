//main.js
const { app, BrowserWindow, Menu, Tray, Notification, net, shell } = require('electron');
const fs = require('fs');
const path = require('node:path');
const crypto = require('crypto');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const { download } = require('electron-dl');
const registry = require('windows/lib/registry');
const contextMenu = require('electron-context-menu');
const { notificationManager } = require('./notification-manager');

// --- Config ---
const URL = 'http://192.168.0.2:8000/';
const DOWNLOADS_PATH = registry(
  'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders'
)['{374DE290-123F-4565-9164-39C4925E467B}']?.value;

app.setAppUserModelId('Messenger');
log.transports.file.resolvePath = () => path.join(process.env.APPDATA, 'messenger/log/main.log');
log.info('Application version ' + app.getVersion());

// --- Helpers ---
function getChecksum(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(filePath);
    input.on('error', reject);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('close', () => resolve(hash.digest('hex')));
  });
}

async function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    try {
      const req = net.request({ url, useSessionCookies: true });
      const chunks = [];
      req.on('response', (res) => {
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks));
            resolve(data);
          } catch (err) {
            reject(err);
          }
        });
      });
      req.on('error', reject);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

function showNotification({ title, body = 'Новое сообщение', onClick, silent = false, chatType } = {}) {
  try {
    // Заменяем стандартные уведомления на кастомные
    notificationManager.showNotification({
      title: title,
      message: body,
      type: 'info',
      duration: 5000,
      onClick: onClick,
      playSound: !silent,
      chatType: chatType
    });
  } catch (err) {
    console.error('Notification error:', err);
  }
}

function notifyEntity(data, mainWindow) {
  if (!data?.name) return false;

  // Определяем заголовок и тело уведомления
  let title, body, url, chatType;

  console.log(data);
  if (data.threadtype === 'channel') {
    // Для канала: заголовок - название канала, тело - от кого сообщение
    title = data.threadname || data.name; // Используем threadname если есть
    const senderInfo = data.sender ? `${data.sender}: ` : '';
    const messageText = data.body || 'Новое сообщение';
    // Обрезаем сообщение если слишком длинное
    body = senderInfo + (messageText.length > 50 ? messageText.substring(0, 47) + '...' : messageText);
    url = URL + `channels/${data.linker}`;
    chatType = 'channel';
  } else {
    // Для личных сообщений: заголовок - имя отправителя, тело - текст сообщения
    title = data.name || data.sender || 'Отправитель';
    const messageText = data.body || 'Новое сообщение';
    // Обрезаем сообщение если слишком длинное
    body = messageText.length > 60 ? messageText.substring(0, 57) + '...' : messageText;
    url = URL + `users/${data.linker}`;
    chatType = 'private'; 
  }

  const containsThumbsUp = body.includes(':thumbs-up:');
  const processedBody = body.replace(/:thumbs-up:/g, '👍');
  console.log(body);
  console.log(processedBody);

  showNotification({
    title,
    body: processedBody,
    onClick: () => {
      mainWindow.loadURL(url);
      mainWindow.show();
    },
    silent: containsThumbsUp,
    chatType: chatType,
  });
  
  !mainWindow.isVisible() && mainWindow.minimize();
  return true;
}

function refreshBadgeCount(id) {
 // console.log(id);
  if (!id) return;
  httpGetJson(`${URL}api/users/${id}/`)
    .then((resp) => {
    //  console.log(resp);
      if (resp) app.setBadgeCount(Object.keys(resp.unread || {}).length);
    })
    .catch((e) => console.error('refreshBadgeCount', e));
}

// --- Context menu ---
contextMenu({
  showSaveImageAs: true,
  showSelectAll: false,
  showInspectElement: true,
  showSearchWithGoogle: false,
});

// --- Main window & logic ---
let mainWindow;
let ID = '';

async function handleDownloadClick(url, originalName) {
  const dir = DOWNLOADS_PATH || process.cwd();
  const ext = path.extname(originalName) || '';
  const baseName = originalName.replace(/\(\d+\)(?=\.[^.]*$|$)/, '').trim();
  const nameWithoutExt = baseName.replace(ext, '');
  const tempName = `temp_${Date.now()}${ext}`;
  const tempPath = path.join(dir, tempName);

  try {
    await download(BrowserWindow.getFocusedWindow(), url, { saveAs: false, filename: tempName, directory: dir });
    const fileHash = await getChecksum(tempPath);

    const dirFiles = fs.readdirSync(dir);
    const duplicateFiles = dirFiles.filter((file) => {
      const fileBase = file.replace(/\(\d+\)(?=\.[^.]*$|$)/, '').trim();
      return fileBase === baseName || (file.startsWith(nameWithoutExt + ' (') && file.endsWith(ext));
    });

    for (const file of duplicateFiles) {
      try {
        const checksum = await getChecksum(path.join(dir, file));
        if (checksum === fileHash) {
          fs.unlinkSync(tempPath);
          shell.openPath(path.join(dir, file));
          return;
        }
      } catch (err) {
        console.error('hash check failed for', file, err);
      }
    }

    let finalName = originalName;
    let i = 1;
    while (dirFiles.includes(finalName)) {
      finalName = `${nameWithoutExt} (${i++})${ext}`;
    }
    fs.renameSync(tempPath, path.join(dir, finalName));
    shell.openPath(path.join(dir, finalName));
  } catch (err) {
    console.error('handleDownloadClick error:', err);
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch (e) {
      /* ignore */
    }
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1050,
    height: 700,
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: true },
  });

  mainWindow.loadURL(URL);
  mainWindow.webContents.reloadIgnoringCache();
  mainWindow.webContents.on('did-fail-load', () => mainWindow.reload());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(URL + 'download/')) {
      BrowserWindow.getAllWindows()[0]
        .webContents.executeJavaScript(`
          (function(){
            var name, message_id;
            Array.from(document.getElementsByTagName('a')).forEach((element) => {
              if(element.href === ${JSON.stringify(url)}){
                name = element.textContent;
                message_id = element.closest('figure.chat-message')?.getAttribute('data-id');
              }
            });
            return [name?.toString() || '', message_id || ''];
          })();
        `)
        .then(async ([originalName]) => {
          if (!originalName) return;
          await handleDownloadClick(url, originalName);
        })
        .catch((err) => console.error('Error executing JS for download:', err));

      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  const dbg = mainWindow.webContents.debugger;
  let isRequestedUnread = false;
  let isRequestedMessage = false;

  try {
    dbg.attach();
  } catch (err) {
    console.error('Debugger attach failed:', err);
  }

  dbg.on('message', async (_event, method, params) => {
    if (method === 'Network.webSocketFrameError') return mainWindow.reload();

    if (method === 'Network.webSocketFrameReceived' || method === 'Network.webSocketFrameSent') {
      let messageJSON;
      try {
        messageJSON = JSON.parse(decodeURIComponent(params?.response?.payloadData));
      } catch (err) {
        return;
      }

      if (messageJSON?.type === 'online' && !ID) {
        ID = messageJSON.id;
        refreshBadgeCount(ID);
      }

      if (method === 'Network.webSocketFrameReceived') {
        if (messageJSON.type === 'read') {
          mainWindow.webContents.executeJavaScript(`
            Array.from(document.querySelectorAll('.chat-unread')).forEach(item => item.classList.remove('chat-unread'));
          `);
        }

        if (messageJSON.type === 'unread') {
          refreshBadgeCount(ID);
          if (!isRequestedUnread) {
            const keys = Object.keys(messageJSON.unread || {});
          //  console.log(messageJSON);
            const last = keys[keys.length - 1];
            if (last) {
              // Используем данные из messageJSON вместо fetch
              const entityData = {
                name: messageJSON.sender,
                threadname: messageJSON.threadname,
                linker: messageJSON.linker,
                threadtype: messageJSON.threadtype,
                body: messageJSON.body,
                sender: messageJSON.sender
              };
              notifyEntity(entityData, mainWindow);
            }
          }
          isRequestedUnread = false;
        }

        if (messageJSON.type === 'message') {
          console.log("if (messageJSON.type === 'message') {");
          if (!isRequestedMessage) {
            console.log("if (!isRequestedMessage) {");

            // Для message типа также используем данные из websocket
            const entityData = {
              name: messageJSON.sender,
              threadname: messageJSON.threadname,
              linker: messageJSON.linker,
              threadtype: messageJSON.threadtype,
              body: messageJSON.body,
              sender: messageJSON.sender
            };
            
            notifyEntity(entityData, mainWindow);
          }
          isRequestedMessage = false;
        }
      }

      if (method === 'Network.webSocketFrameSent') {
        if (messageJSON.type === 'unread') isRequestedUnread = true;
        else if (messageJSON.type === 'message' || messageJSON.type === 'forward') isRequestedMessage = true;
        else if (messageJSON.type === 'user' || messageJSON.type === 'channel') refreshBadgeCount(ID);
      }
    }

    if (method === 'Target.attachedToTarget' && params.targetInfo?.type === 'iframe') {
      try {
        await dbg.sendCommand('Network.enable', null, params.sessionId);
        await dbg.sendCommand('Runtime.enable', null, params.sessionId);
        await dbg.sendCommand('Runtime.runIfWaitingForDebugger', null, params.sessionId);
      } catch (err) {
        console.error('Error auto-attaching to iframe debugger:', err);
      }
    }
  });

  mainWindow.on('close', (ev) => {
    if (mainWindow?.isVisible()) {
      ev.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('show', () => refreshBadgeCount(ID));
  app.on('quit', () => {
    try {
      dbg.detach();
    } catch (e) {}
  });

  await dbg.sendCommand('Network.enable');
  await dbg.sendCommand('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
}

function createTray() {
  const template = [
    { label: 'Открыть', click: () => BrowserWindow.getAllWindows().shift().show() },
    { type: 'separator' },
    {
      label: 'Выйти',
      accelerator: 'CmdOrCtrl+Q',
      click: () => {
        BrowserWindow.getAllWindows().forEach((w) => w.destroy());
        app.quit();
      },
    },
  ];
  const imgPath = path.join(process.resourcesPath, 'icon.png');
  const tray = new Tray(imgPath);
  tray.setToolTip('Messenger');
  tray.setContextMenu(Menu.buildFromTemplate(template));
  tray.on('click', () => BrowserWindow.getAllWindows().shift().show());
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) mainWindow.show();
  });

  app.whenReady().then(() => {
    createWindow();
    createTray();
    autoUpdater.checkForUpdates();
    setInterval(() => autoUpdater.checkForUpdates(), 1000 * 60 * 10);
  });
}

// autoUpdater logging (kept automatic install)
autoUpdater.on('update-available', () => log.info('update-available'));
autoUpdater.on('checking-for-update', () => log.info('checking-for-update'));
autoUpdater.on('download-progress', (p) => log.info('download-progress', p));
autoUpdater.on('update-downloaded', () => {
  log.info('update-downloaded');
  autoUpdater.quitAndInstall(true, true);
});

app.on('activate', () => {
  const window = BrowserWindow.getAllWindows().shift();
  if (window) window.show();
  else createWindow();
});