const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  Notification,
  net,
  pushNotifications,
} = require("electron");

const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

const path = require("node:path");
const contextMenu = require("electron-context-menu");
const { download } = require("electron-dl");
const URL = "http://192.168.0.2:8000/"

app.setAppUserModelId("Messenger");

log.transports.file.resolvePath = () => path.join(process.env.APPDATA, 'messenger/log/main.log');
log.log("Application version" + app.getVersion());

var mainWindow;

contextMenu({
  showSaveImageAs: true,
  showSelectAll: false,
  showInspectElement: true,
  showSearchWithGoogle: false,
});

async function notifyIfChannel(messageJSON, mainWindow){
  try {
    const path_ = URL + `api/channels/${
      Object.keys(messageJSON.unread)[Object.keys(messageJSON.unread).length-1]
    }/`;
    const request = net.request({
      url: path_,
      useSessionCookies: true,
    });
    request.on("response", (response) => {
      const data = [];
      response.on("data", (chunk) => {
        data.push(chunk);
      });
      response.on("end", () => {
        try{
        const resp = JSON.parse(Buffer.concat(data));
        if(resp.name){
          const notification = new Notification({
            title: resp.name,
            body: "Новое сообщение",
          });
          notification.addListener("click", (ev) => {
            mainWindow.loadURL(URL + "channels/" + resp.linker);
            mainWindow.show();
          });
          notification.show();
        }
      }
      catch(error) {
        console.log(error);
      }
      });
    });
    request.end();
  } catch (error) {
    console.log(error);
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1050,
    height: 700,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
    }
  });
  mainWindow.loadURL(URL);

  mainWindow.webContents.on("did-fail-load", (ev) => {
    console.log('did-fail-load');
    mainWindow.reload();
  });

  mainWindow.webContents.setWindowOpenHandler(
    ({ url, referrer, postBody, features, frameName }) => {
      if (url.startsWith(URL + "download/")) {
        BrowserWindow.getAllWindows()[0]
          .webContents.executeJavaScript(
            `
      var name;
      Array.from(document.getElementsByTagName("a")).forEach((element) => {
        if(element.href === ${JSON.stringify(url)})
          name = element.textContent;
      });
      name.toString();
      `
          )
          .then((result) => {
            download(BrowserWindow.getFocusedWindow(), url, {
              saveAs: true,
              filename: result,
            });
          });
        return { action: "deny" };
      }
      return { action: "allow" };
    }
  );

  const _debugger = mainWindow.webContents.debugger;
  var isRequestedUnread = false;
  var isRequestedMessage = false;
  var unreadCollection = {};

  _debugger.attach();
  _debugger.on("message", async (_event, method, params) => {
    if(method === "Network.webSocketFrameError"){
      console.log(method);
      mainWindow.reload();
    }

    if (method === "Network.webSocketFrameReceived") {
      const messageJSON = JSON.parse(
        decodeURIComponent(params?.response?.payloadData)
      );
      if(messageJSON.type === "read"){
        setRead = `var list = document.querySelectorAll(".chat-unread");
                   for(var item of list){
                    item.classList.remove("chat-unread");
                   }`;
        mainWindow.webContents.executeJavaScript(setRead);
      }
      if (messageJSON.type === "unread") {
        app.setBadgeCount(Object.keys(messageJSON.unread).length);
        if (!isRequestedUnread) {
          try {
            if(Object.keys(messageJSON.unread).length > Object.keys(unreadCollection).length){
              for(const [key, value] of Object.entries(unreadCollection)){
                delete messageJSON.unread[key];
              }
            }
            else {
              for(const [key, value] of Object.entries(unreadCollection)){
                if(messageJSON.unread[key] <= value){
                  delete messageJSON.unread[key];
                }
              }
            }
            const path_ = URL + `api/users/${
              Object.keys(messageJSON.unread)[Object.keys(messageJSON.unread).length-1]
            }/`;
            const request = net.request({
              url: path_,
              useSessionCookies: true,
            });
            request.on("response", (response) => {
              const data = [];
              response.on("data", (chunk) => {
                data.push(chunk);
              });
              response.on("end", () => {
                const resp = JSON.parse(Buffer.concat(data));
                if(resp.name){
                  const notification = new Notification({
                    title: resp.name,
                    body: "Новое сообщение",
                  });
                  notification.addListener("click", (ev) => {
                    mainWindow.loadURL(URL + "users/" + resp.linker);
                    mainWindow.show();
                  });
                  notification.show();
                }
                else {
                  notifyIfChannel(messageJSON, mainWindow);
                }
              });
            });
            request.end();
          } catch (error) {
            console.log(error);
          }
        }
        isRequestedUnread = false;
        unreadCollection = messageJSON.unread;
      } else if (messageJSON.type === "message") {
        if (!isRequestedMessage) {
          const path_ = URL + `api/users/${messageJSON.iduser}/`;
          try {
            const request = net.request({
              url: path_,
              useSessionCookies: true,
            });
            request.on("response", (response) => {
              const data = [];
              response.on("data", (chunk) => {
                data.push(chunk);
              });
              response.on("end", () => {
                const resp = JSON.parse(Buffer.concat(data));
                const notification = new Notification({
                  title: resp.name,
                  body: "Новое сообщение",
                });
                notification.addListener("click", (ev) => {
                  mainWindow.show();
                });
                notification.show();
              });
            });
            request.end();
          } catch (er) {
            console.log(error);
          }
        }
        isRequestedMessage = false;
      }
    }

    if (method === "Network.webSocketFrameSent") {
      const messageJSON = JSON.parse(
        decodeURIComponent(params?.response?.payloadData)
      );
      if (messageJSON.type === "unread") {
        isRequestedUnread = true;
      }
      else if (messageJSON.type === "message") {
        isRequestedMessage = true;
      }
      else if (messageJSON.type === "user" || messageJSON.type === "channel"){
        delete unreadCollection[messageJSON.id];
        app.setBadgeCount(Object.keys(unreadCollection).length);
      }
    }

    if (method === "Target.attachedToTarget") {
      // capture iframe websocket request
      if (params.targetInfo.type === "iframe") {
        await _debugger.sendCommand("Network.enable", null, params.sessionId);
        await _debugger.sendCommand("Runtime.enable", null, params.sessionId);
        await _debugger.sendCommand(
          "Runtime.runIfWaitingForDebugger",
          null,
          params.sessionId
        );
      }
    }
  });

  mainWindow.on("close", (ev) => {
    if (mainWindow?.isVisible()) {
      ev.preventDefault();
      mainWindow.hide();
    }
  });

  app.on("quit", () => {
    _debugger.detach();
  });

  await _debugger.sendCommand("Network.enable");
  await _debugger.sendCommand("Target.setAutoAttach", {
    autoAttach: true,
    waitForDebuggerOnStart: true,
    flatten: true,
  });
}

function createTray() {
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Открыть",
      click: () => {
        BrowserWindow.getAllWindows().shift().show();
      },
    },
    { type: "separator" },
    {
      label: "Выйти",
      accelerator: "CmdOrCtrl+Q",
      click: () => {
        BrowserWindow.getAllWindows().forEach((w) => w.destroy());
        app.quit();
      },
    },
  ]);
  const imgPath = path.join(process.resourcesPath, "icon.png");
  const tray = new Tray(imgPath);
  tray.setToolTip("Messenger");
  tray.setContextMenu(contextMenu);
  tray.on("click", () => {
    BrowserWindow.getAllWindows().shift().show();
  });
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    if (mainWindow) {
      mainWindow.show();
      //mainWindow.focus()
    }
  });
  app.whenReady().then(() => {
    createWindow();
    createTray();
    autoUpdater.checkForUpdates();
    setInterval(() => {
      autoUpdater.checkForUpdates();
    }, 1000 * 60 * 10);
  });
}

autoUpdater.on("update-available", ()=>{
  log.info("update-available");
});

autoUpdater.on("checking-for-update", ()=>{
  log.info("checking-for-update");
});

autoUpdater.on("download-progress", ()=>{
  log.info("download-progress");
});

autoUpdater.on("update-downloaded", ()=>{
  log.info("update-downloaded");
  autoUpdater.quitAndInstall(true, true);
})

autoUpdater.on("download-progress", (progressTrack)=>{
  log.info("\n\ndownload-progress");
  log.info(progressTrack);
});

app.on("activate", () => {
  const window = BrowserWindow.getAllWindows().shift();
  if (window) {
    window.show();
  } else {
    createWindow();
  }
});
