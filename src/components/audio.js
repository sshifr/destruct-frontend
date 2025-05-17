import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import "../styles/Audio.css";

const baseUrl = 'http://localhost:3001';

// Функция для получения имени файла из пути
const getFilename = (filepath) => {
  return filepath.split('/').pop();
};

async function uploadFile(file, setFilePath, setLoading) {
  const formData = new FormData();
  formData.append('file', file);

  setLoading(true);

  try {
    const response = await axios.post(`${baseUrl}/upload-audio`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 10000 // 10 seconds timeout
    });
    console.log('Файл загружен:', response.data.filePath);
    setFilePath(response.data.filePath);
  } catch (error) {
    console.error('Ошибка загрузки файла:', error);
    if (error.code === 'ERR_NETWORK') {
      alert('Ошибка сети: Не удалось подключиться к серверу. Пожалуйста, проверьте, что сервер запущен и доступен.');
    } else {
      alert(`Ошибка загрузки файла: ${error.response?.data?.error || error.message}`);
    }
  } finally {
    setLoading(false);
  }
}

async function runAnalysis(filePath, setLoading, setLogs) {
  setLoading(true);
  setLogs([]); // Очищаем предыдущие логи

  try {
    const response = await fetch(`${baseUrl}/run-audio-analysis?filePath=${encodeURIComponent(filePath)}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            let logMessage = '';
            let logType = 'info';

            switch (data.status) {
              case 'info':
                logMessage = data.message;
                if (data.message.includes('Паралингвистический признак')) {
                  logType = 'emotion';
                }
                break;
              case 'error':
                logMessage = `Ошибка: ${data.error || data.message}`;
                logType = 'error';
                break;
              default:
                logMessage = JSON.stringify(data);
            }

            setLogs(prev => [...prev, { message: logMessage, type: logType }]);
          } catch (e) {
            console.error('Error parsing SSE data:', e);
            setLogs(prev => [...prev, { message: `Ошибка парсинга данных: ${e.message}`, type: 'error' }]);
          }
        }
      }
    }
  } catch (error) {
    console.error('Ошибка запуска анализа:', error);
    setLogs(prev => [...prev, { message: `Ошибка: ${error.message}`, type: 'error' }]);
  } finally {
    setLoading(false);
  }
}

// Компонент кнопки обновления
function RefreshButton() {
  const handleRefresh = () => {
    window.location.reload();
  };

  return (
    <div className="refresh-button" onClick={handleRefresh}>
      <i className="fas fa-sync-alt"></i>
    </div>
  );
}

function Audio() {
  const [filePath, setFilePath] = useState('');
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const logsContainerRef = useRef(null);

  const scrollToBottom = () => {
    if (logsContainerRef.current) {
      const logsElement = logsContainerRef.current.querySelector('.logs');
      if (logsElement) {
        logsElement.scrollTop = logsElement.scrollHeight;
      }
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [logs]);

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (file) {
      uploadFile(file, setFilePath, setLoading);
    }
  };

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('audio/')) {
      uploadFile(file, setFilePath, setLoading);
    } else {
      alert('Пожалуйста, загрузите аудио файл');
    }
  };

  const handleStartClick = () => {
    if (!filePath || isProcessing) {
      return;
    }
    setIsProcessing(true);
    runAnalysis(filePath, setLoading, setLogs);
  };

  const handleStopClick = async () => {
    try {
      await axios.get(`${baseUrl}/stop-server`);
      setIsProcessing(false);
      setLogs(prev => [
        ...prev,
        {
          message: 'Обработка остановлена',
          type: 'info'
        }
      ]);
    } catch (error) {
      console.error('Ошибка при остановке сервера:', error);
      setLogs(prev => [
        ...prev,
        {
          message: `Ошибка при остановке: ${error.message}`,
          type: 'error'
        }
      ]);
    }
  };

  return (
    <div className="audio-component">
      <input
        type="file"
        accept="audio/*"
        onChange={handleFileChange}
        style={{ display: 'none' }}
        id="audioInput"
      />
      <div
        className={`load-audio ${loading ? 'disabled' : ''} ${isDragging ? 'dragging' : ''}`}
        onClick={() => !loading && document.getElementById('audioInput').click()}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {loading ? (
          <div className="spinner"></div>
        ) : filePath ? (
          <div className="preview-container">
            <audio controls src={`${baseUrl}/uploads/${getFilename(filePath)}`} />
          </div>
        ) : (
          <div className="upload-prompt">
            <div className="upload-icon">
              <i className="fas fa-music"></i>
            </div>
            <div className="upload-text">
              <p>Анализ аудио</p>
              <p className="upload-hint">Перетащите файл сюда или кликните для выбора</p>
            </div>
          </div>
        )}
      </div>

      <div className="buttons-container">
        <div
          className={`button ${isProcessing ? 'button-disabled' : ''}`}
          onClick={handleStartClick}
        >
          Начать
        </div>
        {isProcessing && (
          <div className="button stop-button" onClick={handleStopClick}>
            Остановить
          </div>
        )}
      </div>

      {logs.length > 0 && (
        <div className="logs-container" ref={logsContainerRef}>
          <h3>Результаты анализа:</h3>
          <div className="logs">
            {logs.map((log, index) => {
              // Определяем цветовую схему для негативных/позитивных результатов
              let borderColor = '#e0e0e0';
              let backgroundColor = '#fff';
              let isNegative = false;
              if (log.type === 'emotion' || log.message.match(/(агресс|злость|депресс|террор|ненавист|нацизм|негатив|недобр|недруже|недоволь|грусть|страх|нцензур|оскорб|угроза|разжигание|экстремист|заложник|расстрел|обезглав|джихад|публичные призывы|статья 280|статья 206|статья 20.1)/i)) {
                borderColor = 'rgba(255, 0, 0, 0.5)';
                backgroundColor = 'rgba(255, 0, 0, 0.07)';
                isNegative = true;
              } else if (log.message.match(/(нейтраль|позитив|одобр|счастье|лучш|хорош|отсутствие деструктивного|не принимать какие-либо действия)/i)) {
                borderColor = 'rgba(0, 200, 83, 0.5)';
                backgroundColor = 'rgba(0, 200, 83, 0.07)';
              }
              return (
                <div
                  key={index}
                  className={`log-line log-${log.type}`}
                  style={{
                    border: `2px solid ${borderColor}`,
                    background: backgroundColor,
                    borderRadius: '10px',
                    padding: '10px',
                    marginBottom: '10px',
                    whiteSpace: 'pre-line',
                    fontWeight: isNegative ? 'bold' : 'normal',
                    color: '#000000'
                  }}
                >
                  {log.message}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <RefreshButton />
    </div>
  );
}

export default Audio;
