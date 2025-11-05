const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const { app } = require('electron');
const fs = require('fs');

class NotificationManager {
  constructor() {
    this.notifications = new Map();
    this.margin = 20;
    this.notificationHeight = 140;
    this.soundEnabled = true;
    this.soundPath = path.join(__dirname, 'assets', 'sounds', 'notification.mp3');
  }

  // Метод для воспроизведения звука
   playNotificationSound() {
    if (!this.soundEnabled) return;

    try {
      // Проверяем существование файла
      if (!fs.existsSync(this.soundPath)) {
        console.error('Sound file not found:', this.soundPath);
        this.playFallbackSound();
        return;
      }

      // Создаем окно для воспроизведения звука
      const soundWindow = new BrowserWindow({
        width: 100,
        height: 100,
        show: false,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false,
          webSecurity: false // Отключаем безопасность для file:// протокола
        }
      });

      // Преобразуем путь для HTML
      const soundFileUrl = this.soundPath.replace(/\\/g, '/');
      
      const soundHTML = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
        </head>
        <body>
          <audio id="soundPlayer" autoplay>
            <source src="file:///${soundFileUrl}" type="audio/mpeg">
            Your browser does not support the audio element.
          </audio>
          <script>
            const audio = document.getElementById('soundPlayer');
            audio.volume = 0.6;
            
            audio.addEventListener('canplaythrough', () => {
              console.log('Audio can play');
              audio.play().catch(error => {
                console.error('Audio play failed:', error);
                window.close();
              });
            });
            
            audio.addEventListener('error', (e) => {
              console.error('Audio error:', e);
              window.close();
            });
            
            audio.addEventListener('ended', () => {
              console.log('Audio ended');
              setTimeout(() => window.close(), 100);
            });
            
            // На всякий случай закрываем через 5 секунд
            setTimeout(() => window.close(), 5000);
          </script>
        </body>
        </html>
      `;

      soundWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(soundHTML)}`);
      
      soundWindow.on('closed', () => {
        console.log('Sound window closed');
      });

    } catch (error) {
      console.error('Error playing notification sound:', error);
      this.playFallbackSound();
    }
  }

  // Резервный метод для системного звука
  playFallbackSound() {
    try {
      if (process.platform === 'win32') {
        const { exec } = require('child_process');
        // Используем системный звук уведомления Windows
        exec('powershell -c (New-Object Media.SoundPlayer "SystemNotification").PlaySync()', (error) => {
          if (error) {
            console.error('Fallback sound failed:', error);
          }
        });
      }
    } catch (error) {
      console.error('Fallback sound error:', error);
    }
  }

  // Альтернативный метод через shell (для некоторых систем)
  playSoundAlternative() {
    const { exec } = require('child_process');
    
    // Для Windows
    if (process.platform === 'win32') {
      exec(`powershell -c (New-Object Media.SoundPlayer "${this.soundPath}").PlaySync()`, (error) => {
        if (error) console.error('Error playing sound:', error);
      });
    }
    // Для macOS
    else if (process.platform === 'darwin') {
      exec(`afplay "${this.soundPath}"`, (error) => {
        if (error) console.error('Error playing sound:', error);
      });
    }
    // Для Linux
    else {
      exec(`aplay "${this.soundPath}" || paplay "${this.soundPath}"`, (error) => {
        if (error) console.error('Error playing sound:', error);
      });
    }
  }

  showNotification({ title, message, icon, type = 'info', duration = 5000, onClick = null, playSound = true, chatType = 'private' }) {
    // Воспроизводим звук перед показом уведомления
    if (playSound && this.soundEnabled) {
      this.playNotificationSound();
    }

    const display = screen.getPrimaryDisplay();
    const workArea = display.workArea;
    
    const id = Date.now().toString();
    const y = this.calculatePosition(id, workArea);

    const notifyWindow = new BrowserWindow({
      width: 340,
      height: this.notificationHeight,
      frame: false,
      resizable: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      show: false,
      x: workArea.width - 340 - this.margin,
      y: y,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
      backgroundColor: '#00000000',
      opacity: 1,
      hasShadow: true,
    });

    notifyWindow.setIgnoreMouseEvents(false);
    notifyWindow.loadFile(path.join(__dirname, 'notify.html'));

    notifyWindow.setBackgroundM
    // Сохраняем callback для клика
    if (onClick) {
      notifyWindow.onClickCallback = onClick;
    }

    notifyWindow.once('ready-to-show', () => {
      notifyWindow.show();
      notifyWindow.webContents.send('notify-data', { 
        id, title, message, icon, type, duration, chatType 
      });
    });

    notifyWindow.on('closed', () => {
      this.notifications.delete(id);
      this.rearrangeNotifications();
    });

    this.notifications.set(id, notifyWindow);

    setTimeout(() => {
      if (!notifyWindow.isDestroyed()) {
        this.closeNotification(id);
      }
    }, duration);

    return id;
  }

  calculatePosition(id, workArea) {
    const count = this.notifications.size;
    return workArea.height - this.margin - 
           (this.notificationHeight + this.margin) * (count + 1);
  }

  rearrangeNotifications() {
    const display = screen.getPrimaryDisplay();
    const workArea = display.workArea;
    let index = 0;

    this.notifications.forEach((window, id) => {
      const y = workArea.height - this.margin - 
                (this.notificationHeight + this.margin) * (index + 1);
      window.setPosition(workArea.width - 340 - this.margin, y);
      index++;
    });
  }

  closeNotification(id) {
    const window = this.notifications.get(id);
    if (window && !window.isDestroyed()) {
      window.close();
    }
  }

  // Методы для управления звуком
  enableSound() {
    this.soundEnabled = true;
  }

  disableSound() {
    this.soundEnabled = false;
  }

  setSoundPath(newPath) {
    this.soundPath = newPath;
  }
}

const notificationManager = new NotificationManager();

// Обработчик IPC для закрытия уведомлений
ipcMain.handle('close-notification', (event, id) => {
  notificationManager.closeNotification(id);
});

// Обработчик для клика по уведомлению
ipcMain.handle('notification-clicked', (event, id) => {
  const window = notificationManager.notifications.get(id);
  if (window && window.onClickCallback) {
    window.onClickCallback();
  }
});

module.exports = { notificationManager };