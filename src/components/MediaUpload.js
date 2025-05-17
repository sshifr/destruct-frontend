import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import "../styles/Media.css";

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
    const endpoint = file.type.startsWith('video/') ? '/upload-video' : '/upload-photo';
    const response = await axios.post(`${baseUrl}${endpoint}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    console.log('Файл загружен:', response.data.filePath);
    setFilePath(response.data.filePath);
  } catch (error) {
    console.error('Ошибка загрузки файла:', error);
    alert(`Ошибка загрузки файла: ${error.response?.data?.error || error.message}`);
  } finally {
    setLoading(false);
  }
}

function MediaUpload() {
  const [filePath, setFilePath] = useState('');
  const [loading, setLoading] = useState(false);
  const [resultPaths, setResultPaths] = useState([]);
  const [logs, setLogs] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [motionDetection, setMotionDetection] = useState(false);
  const [nightMode, setNightMode] = useState(false);
  const [emotionDetection, setEmotionDetection] = useState(false);
  const [quickSearch, setQuickSearch] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const logsContainerRef = useRef(null);
  const [expandedArticles, setExpandedArticles] = useState({});

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

  const handleStartClick = () => {
    if (!filePath || isProcessing) {
      return;
    }
    setIsProcessing(true);
    runAnalysis(filePath, setLoading, setResultPaths, setLogs, {
      motionDetection,
      nightMode,
      emotionDetection,
      quickSearch
    });
  };

  const handleStopClick = async () => {
    try {
      // Останавливаем сервер, что прервет все процессы
      await axios.get(`${baseUrl}/stop-server`);
      
      // Сбрасываем состояние
      setIsProcessing(false);
      setLoading(false);
      setLogs(prev => [
        ...prev,
        {
          message: 'Обработка остановлена',
          type: 'info'
        }
      ]);

      // Очищаем результаты
      setResultPaths([]);
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

  // Функция для переключения отображения наказания
  const toggleArticleDetails = (index) => {
    setExpandedArticles(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  async function runAnalysis(filePath, setLoading, setResultPaths, setLogs, { motionDetection, nightMode, emotionDetection, quickSearch }) {
    setLoading(true);
    setLogs([]);
    setResultPaths([]);

    try {
      const response = await fetch(`${baseUrl}/run-python?filePath=${encodeURIComponent(filePath)}&motionDetection=${motionDetection}&nightMode=${nightMode}&emotionDetection=${emotionDetection}&quickSearch=${quickSearch}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        buffer += chunk;

        // Обрабатываем все полные сообщения в буфере
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Оставляем неполное сообщение в буфере

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const jsonStr = line.slice(6).trim();
              if (!jsonStr) continue; // Пропускаем пустые сообщения
              
              const data = JSON.parse(jsonStr);
              let logMessage = '';
              let logType = 'info';

              switch (data.status) {
                case 'info':
                  logMessage = data.message;
                  // Проверяем на специальные сообщения режимов
                  if (data.message.includes('Motion detected')) {
                    logType = 'motion';
                  } else if (data.message.includes('Night mode detected')) {
                    logType = 'night';
                  } else if (data.message.includes('Доминирующая эмоция:')) {
                    logType = 'emotion';
                  } else if (data.message.includes('Processing frame')) {
                    // Извлекаем информацию о прогрессе
                    const frameMatch = data.message.match(/Processing frame (\d+)\/(\d+)/);
                    if (frameMatch) {
                      const [, currentFrame, totalFrames] = frameMatch;
                      const progress = Math.round((currentFrame / totalFrames) * 100);
                      logMessage = `Обработка кадра ${currentFrame}/${totalFrames} (${progress}%)`;
                      logType = 'progress';
                    }
                  } else if (data.message.includes('Speed:')) {
                    // Извлекаем информацию о скорости обработки
                    const speedMatch = data.message.match(/Speed: ([\d.]+)ms preprocess, ([\d.]+)ms inference, ([\d.]+)ms postprocess/);
                    if (speedMatch) {
                      const [, preprocess, inference, postprocess] = speedMatch;
                      logMessage = `Скорость обработки: ${preprocess}мс препроцесс, ${inference}мс инференс, ${postprocess}мс постпроцесс`;
                      logType = 'speed';
                    }
                  } else if (data.message.includes('Results saved to')) {
                    logMessage = 'Результаты сохранены';
                    logType = 'save';
                  } else if (data.message.includes('detected') || data.message.includes('no detections')) {
                    // Проверяем обнаруженные объекты
                    if (data.message.includes('no detections')) {
                      logMessage = 'Объекты не обнаружены';
                      logType = 'detection';
                    } else {
                      // Ищем паттерн "X objects: object1, object2, ..."
                      const objectsMatch = data.message.match(/(\d+) objects?: (.+)/);
                      if (objectsMatch) {
                        const [, count, objects] = objectsMatch;
                        logMessage = `Обнаружено ${count} объектов: ${objects}`;
                        logType = 'detection';
                      }
                    }
                  } else if (data.message.includes('Датчик движения активирован')) {
                    logMessage = 'Датчик движения активирован';
                    logType = 'motion';
                  } else if (data.message.includes('Ночной режим активирован')) {
                    logMessage = 'Ночной режим активирован';
                    logType = 'night';
                  }
                  break;
                case 'danger':
                  logMessage = data.message;
                  logType = 'danger';
                  if (quickSearch) {
                    setIsProcessing(false);
                    setLoading(false);
                  }
                  break;
                case 'progress':
                  logMessage = `Модель ${data.model}: ${data.progress}% (кадр ${data.currentFrame}/${data.totalFrames})`;
                  logType = 'progress';
                  break;
                case 'complete':
                  logMessage = data.message;
                  setIsProcessing(false);
                  if (data.resultPaths && Array.isArray(data.resultPaths)) {
                    setResultPaths(data.resultPaths);
                  }
                  logType = 'complete';
                  break;
                case 'error':
                  logMessage = `Ошибка: ${data.error || data.message}`;
                  logType = 'error';
                  break;
                default:
                  logMessage = JSON.stringify(data);
                  logType = 'info';
              }

              setLogs(prev => [...prev, { message: logMessage, type: logType }]);
            } catch (e) {
              console.error('Error parsing SSE data:', e, 'Raw data:', line);
              setLogs(prev => [...prev, { 
                message: `Ошибка парсинга данных: ${e.message}. Сырые данные: ${line}`, 
                type: 'error' 
              }]);
            }
          }
        }
      }
    } catch (error) {
      console.error('Ошибка запуска Python:', error);
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
    if (file && (file.type.startsWith('video/') || file.type.startsWith('image/'))) {
      uploadFile(file, setFilePath, setLoading);
    } else {
      alert('Пожалуйста, загрузите видео или изображение');
    }
  };

  return (
    <div className="media-component">
      <input
        type="file"
        accept="image/*,video/*"
        onChange={handleFileChange}
        style={{ display: 'none' }}
        id="fileInput"
      />
      <div
        className={`load-media ${loading ? 'disabled' : ''} ${isDragging ? 'dragging' : ''}`}
        onClick={() => !loading && document.getElementById('fileInput').click()}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {loading ? (
          <div className="spinner"></div>
        ) : filePath ? (
          <div className="preview-container">
            {filePath.endsWith('.mp4') ? (
              <video controls src={`${baseUrl}/uploads/${getFilename(filePath)}`} />
            ) : (
              <img src={`${baseUrl}/uploads/${getFilename(filePath)}`} alt="Preview" />
            )}
          </div>
        ) : (
          <div className="upload-prompt">
            <div className="upload-icon">
              <i className="fas fa-cloud-upload-alt"></i>
            </div>
            <div className="upload-text">
              <p>Анализ по фото и видео</p>
              <p className="upload-hint">Перетащите файл сюда или кликните для выбора</p>
            </div>
          </div>
        )}
      </div>

      <div className="mode-toggles">
        <div className="mode-toggle">
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={motionDetection}
              onChange={(e) => setMotionDetection(e.target.checked)}
              disabled={isProcessing}
            />
            <span className="toggle-text">Датчик движения</span>
          </label>
        </div>
        <div className="mode-toggle">
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={nightMode}
              onChange={(e) => setNightMode(e.target.checked)}
              disabled={isProcessing}
            />
            <span className="toggle-text">Ночной режим</span>
          </label>
        </div>
        <div className="mode-toggle">
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={emotionDetection}
              onChange={(e) => setEmotionDetection(e.target.checked)}
              disabled={isProcessing}
            />
            <span className="toggle-text">Распознать эмоции</span>
          </label>
        </div>
        <div className="mode-toggle">
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={quickSearch}
              onChange={(e) => setQuickSearch(e.target.checked)}
              disabled={isProcessing}
            />
            <span className="toggle-text">Быстрый поиск</span>
          </label>
        </div>
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
          <h3>Логи обработки:</h3>
          <div className="logs">
            {logs.map((log, index) => (
              <div key={index} className={`log-line log-${log.type}`}>
                {log.message}
              </div>
            ))}
          </div>
        </div>
      )}

      {resultPaths && resultPaths.length > 0 && (
        <div className="result-container">
          <h3>Результаты обработки:</h3>
          <div className="results-grid">
            {resultPaths.map((path, index) => {
              // Для быстрого поиска ищем сохраненные кадры
              if (quickSearch) {
                const baseName = path.split('/').pop().split('.')[0];
                const isViolence = path.includes('predict_violence');
                
                // Проверяем наличие night_motion изображения
                const hasNightMotion = logs.some(log => 
                  log && log.message && 
                  (log.message.includes('WARNING: Motion detected in night scene!') ||
                   log.message.includes('Exiting process due to motion in night scene'))
                );

                // Определяем путь к изображению
                let imagePath;
                if (hasNightMotion) {
                  imagePath = isViolence ? 
                    `/result/detect/predict_violence/${baseName}_night_motion.jpg` :
                    `/result/detect/predict/${baseName}_night_motion.jpg`;
                } else {
                  const suffix = isViolence ? '_violence' : '_dangerous_object';
                  imagePath = path.replace(/\.[^/.]+$/, `${suffix}.jpg`);
                }

                return (
                  <div key={index} className="result-item">
                    <h4>{isViolence ? 'Модель насилия' : 'Модель опасных объектов'}</h4>
                    <img 
                      src={`${baseUrl}${imagePath}`}
                      alt={`Result ${index + 1}`}
                      style={{
                        width: '100%',
                        height: 'auto',
                        borderRadius: '8px',
                        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)'
                      }}
                    />
                    <div style={{
                      marginTop: '8px',
                      padding: '8px',
                      backgroundColor: 'rgba(255, 255, 255, 0.1)',
                      borderRadius: '4px',
                      fontSize: '14px',
                      color: '#ffffff'
                    }}>
                      {hasNightMotion ? 'Обнаружено движение' : 
                       isViolence ? 'Обнаружено насилие' : 'Обнаружен опасный объект'}
                    </div>
                  </div>
                );
              }
              
              // Для обычного режима оставляем старую логику
              return (
                <div key={index} className="result-item">
                  <h4>Модель {index + 1}</h4>
                  {filePath.endsWith('.mp4') ? (
                    <video controls src={`${baseUrl}${path}`} />
                  ) : (
                    <img src={`${baseUrl}${path.replace(/\.[^/.]+$/, '.jpg')}`} alt={`Result ${index + 1}`} />
                  )}
                </div>
              );
            })}
          </div>
          <div className="detection-info">
            <h3>Что было обнаружено:</h3>
            <div className="detection-messages">
              {(() => {
                // Проверка на существование массива логов
                if (!logs || !Array.isArray(logs)) {
                  return (
                    <div className="message-value">
                      <p>Нет данных для отображения</p>
                    </div>
                  );
                }

                // Список опасных объектов
                const dangerousObjects = new Set([
                  'antifa', 'cocaine', 'confederate-flag', 'destroy',
                  'fire', 'glass-defect', 'gun', 'heroin', 'isis',
                  'knife', 'marijuana', 'rocket', 'shrooms', 'smoke', 'swastika',
                  'wolfsangel', 'celtic_cross', 'Violence', 'cigarette', 'graffiti'
                ]);

                // Категоризация правонарушений
                const weaponObjects = ['gun', 'knife', 'rocket', 'threat', 'kill', 'murder', 'death'];
                const drugObjects = ['cocaine', 'heroin', 'marijuana', 'shrooms'];
                const extremismObjects = ['antifa', 'confederate-flag', 'isis', 'swastika', 'wolfsangel', 'celtic_cross'];
                const violenceObjects = ['violence', 'Violence'];
                const prohibitedObjects = ['cigarette', 'smoke'];
                const pettyHooliganismObjects = ['glass-defect', 'graffiti'];
                const communalViolationsObjects = ['destroy', 'glass-defect'];

                // Собираем все объекты из всех логов
                const allObjects = new Set();
                if (quickSearch) {
                  // Для быстрого поиска ищем объекты в логах обработки кадров
                  logs
                    .filter(log => 
                      log && log.message && (
                        log.message.includes('0: 384x640') || // Формат вывода YOLO
                        log.message.includes('detected') ||
                        log.message.includes('objects:')
                      )
                    )
                    .forEach(log => {
                      // Ищем паттерн "0: 384x640 N object, time"
                      const yoloMatch = log.message.match(/0: \d+x\d+ \d+ ([^,]+)/);
                      if (yoloMatch) {
                        const objects = yoloMatch[1].split(' ');
                        objects.forEach(obj => allObjects.add(obj));
                      }
                      
                      // Ищем паттерн "detected N objects: object1, object2, ..."
                      const detectedMatch = log.message.match(/detected \d+ objects: (.+)/);
                      if (detectedMatch) {
                        const objects = detectedMatch[1].split(',').map(obj => obj.trim());
                        objects.forEach(obj => allObjects.add(obj));
                      }
                    });
                } else {
                  // Для обычного режима оставляем старую логику
                  logs
                    .filter(log =>
                      log && log.message && (
                        log.message.includes('Итоговый список обнаруженных объектов:') ||
                        (log.message.includes('detected') && log.message.includes('objects:'))
                      )
                    )
                    .forEach(log => {
                      if (log.message.includes('Итоговый список обнаруженных объектов:')) {
                        const objects = log.message.split('Итоговый список обнаруженных объектов:')[1].trim().split(',');
                        objects.forEach(obj => allObjects.add(obj.trim()));
                      } else {
                        const match = log.message.match(/detected \d+ objects: (.+)/);
                        if (match) {
                          const objects = match[1].split(',').map(obj => obj.trim());
                          objects.forEach(obj => allObjects.add(obj));
                        }
                      }
                    });
                }

                const isDangerous = (obj) => {
                  return dangerousObjects.has(obj.toLowerCase()) || dangerousObjects.has(obj);
                };

                // Находим пересечение опасных объектов с обнаруженными
                const foundDangerousObjects = Array.from(allObjects).filter(obj =>
                  isDangerous(obj)
                );

                // Соберем законы, которые были нарушены
                const violatedLaws = [];

                // Проверяем какие категории опасных объектов были обнаружены
                const weaponDetected = foundDangerousObjects.some(obj =>
                  weaponObjects.includes(obj.toLowerCase()) || weaponObjects.includes(obj)
                );

                const drugsDetected = foundDangerousObjects.some(obj =>
                  drugObjects.includes(obj.toLowerCase()) || drugObjects.includes(obj)
                );

                const extremismDetected = foundDangerousObjects.some(obj =>
                  extremismObjects.includes(obj.toLowerCase()) || extremismObjects.includes(obj)
                );

                const violenceDetected = foundDangerousObjects.some(obj =>
                  violenceObjects.includes(obj.toLowerCase()) || violenceObjects.includes(obj)
                );

                const prohibitedItemsDetected = foundDangerousObjects.some(obj =>
                  prohibitedObjects.includes(obj.toLowerCase()) || prohibitedObjects.includes(obj)
                );

                const pettyHooliganismDetected = foundDangerousObjects.some(obj =>
                  pettyHooliganismObjects.includes(obj.toLowerCase()) || pettyHooliganismObjects.includes(obj)
                );

                // Проверяем нарушения ЖКХ
                const communalViolationsDetected = foundDangerousObjects.some(obj =>
                  communalViolationsObjects.includes(obj.toLowerCase()) || communalViolationsObjects.includes(obj)
                );
                if (communalViolationsDetected) {
                  violatedLaws.push('КоАП_7.22');
                  violatedLaws.push('КоАП_12.33');
                }

                // Добавляем соответствующие законы
                if (weaponDetected) {
                  violatedLaws.push('КоАП_20.8');
                  violatedLaws.push('УК_119');
                  violatedLaws.push('УК_105');
                }
                if (drugsDetected) {
                  violatedLaws.push('КоАП_6.9');
                  violatedLaws.push('УК_228');
                }
                if (extremismDetected) violatedLaws.push('УК_282');
                if (violenceDetected) {
                  violatedLaws.push('УК_213');
                  violatedLaws.push('УК_111');
                }
                if (prohibitedItemsDetected) violatedLaws.push('КоАП_6.24');
                if (pettyHooliganismDetected) violatedLaws.push('КоАП_20.1');

                // Проверяем наличие движения в ночной сцене
                const hasMotion = logs.some(log =>
                  log && log.type === 'motion' && log.message && log.message.includes('Motion detected')
                );
                const isNightScene = logs.some(log =>
                  log && log.type === 'night' && log.message && log.message.includes('Night scene')
                );

                // Информация о законах с наказаниями
                const lawsWithPunishments = [
                  {
                    id: 'КоАП_20.8',
                    title: 'Статья 20.8 КоАП РФ (нарушение правил хранения оружия)',
                    punishment: 'Штраф для граждан от 3 000 до 5 000 рублей с конфискацией оружия или без таковой.'
                  },
                  {
                    id: 'УК_228',
                    title: 'Статья 228 УК РФ (незаконный оборот наркотических средств)',
                    punishment: 'Лишение свободы на срок от 3 до 10 лет со штрафом до 500 000 рублей.'
                  },
                  {
                    id: 'КоАП_6.9',
                    title: 'Статья 6.9 КоАП РФ (потребление наркотических средств)',
                    punishment: 'Штраф от 4 000 до 5 000 рублей или административный арест на срок до 15 суток.'
                  },
                  {
                    id: 'УК_282',
                    title: 'Статья 282 УК РФ (пропаганда экстремизма)',
                    punishment: 'Лишение свободы на срок от 2 до 5 лет.'
                  },
                  {
                    id: 'УК_213',
                    title: 'Статья 213 УК РФ (хулиганство)',
                    punishment: 'Лишение свободы на срок до 5 лет.'
                  },
                  {
                    id: 'УК_111',
                    title: 'Статья 111 УК РФ (причинение тяжкого вреда здоровью)',
                    punishment: 'Лишение свободы на срок от 3 до 8 лет.'
                  },
                  {
                    id: 'КоАП_6.24',
                    title: 'Статья 6.24 КоАП РФ (курение в местах, где это запрещено)',
                    punishment: 'Штраф от 500 до 3 000 рублей.'
                  },
                  {
                    id: 'КоАП_20.1',
                    title: 'Статья 20.1 КоАП РФ (мелкое хулиганство)',
                    punishment: 'Штраф от 1 000 до 2 500 рублей или административный арест на срок до 15 суток.'
                  },
                  {
                    id: 'УК_139',
                    title: 'Статья 139 УК РФ (незаконное проникновение в жилище)',
                    punishment: 'Штраф до 40 000 рублей или лишение свободы на срок до 3 лет.'
                  },
                  {
                    id: 'УК_215.4',
                    title: 'Статья 215.4 УК РФ (незаконное проникновение на охраняемый объект)',
                    punishment: 'Штраф до 200 000 рублей или лишение свободы на срок до 3 лет.'
                  },
                  {
                    id: 'КоАП_20.17',
                    title: 'Статья 20.17 КоАП РФ (нарушение пропускного режима охраняемого объекта)',
                    punishment: 'Штраф от 3 000 до 5 000 рублей или административный арест на срок до 15 суток.'
                  },
                  {
                    id: 'УК_119',
                    title: 'Статья 119 УК РФ (угроза убийством или причинением тяжкого вреда здоровью)',
                    punishment: 'Лишение свободы на срок до 2 лет.'
                  },
                  {
                    id: 'УК_105',
                    title: 'Статья 105 УК РФ (угроза совершения убийства)',
                    punishment: 'Лишение свободы на срок от 6 до 15 лет.'
                  },
                  {
                    id: 'КоАП_7.22',
                    title: 'Статья 7.22 КоАП РФ (нарушение правил содержания и ремонта жилых домов)',
                    punishment: 'Штраф для должностных лиц от 4 000 до 5 000 рублей; для юридических лиц - от 40 000 до 50 000 рублей.'
                  },
                  {
                    id: 'КоАП_12.33',
                    title: 'Статья 12.33 КоАП РФ (повреждение дорог и дорожных сооружений)',
                    punishment: 'Штраф для граждан от 5 000 до 10 000 рублей; для должностных лиц - от 25 000 до 30 000 рублей; для юридических лиц - от 300 000 до 500 000 рублей.'
                  }
                ];

                // Если движение в ночной сцене, добавляем законы о проникновении
                if (isNightScene && hasMotion) {
                  violatedLaws.push('УК_139');
                  violatedLaws.push('УК_215.4');
                  violatedLaws.push('КоАП_20.17');
                }

                // Функция для поиска законов по ID
                const findLawsById = (lawIds) => {
                  return lawsWithPunishments.filter(law => lawIds.includes(law.id));
                };

                // Соберем законы, которые были нарушены
                const violatedLawsDetails = findLawsById(violatedLaws);

                // Определяем статус отчета
                const statusClass = violatedLawsDetails.length > 0 ? 'danger' : 'safe';

                // Выводим отладочную информацию
                console.log('All objects:', Array.from(allObjects));
                console.log('Dangerous objects found:', foundDangerousObjects);
                console.log('Violated laws:', violatedLaws);

                // Добавляем рекомендации по эмоциям
                const emotionRecommendations = {
                  'angry': {
                    title: 'Обнаружена агрессия',
                    recommendations: [
                      'Рекомендуется консультация психолога для работы с гневом',
                      'Показана групповая терапия для управления гневом',
                      'Необходима диагностика причин агрессивного поведения'
                    ]
                  },
                  'disgust': {
                    title: 'Обнаружено отвращение',
                    recommendations: [
                      'Требуется консультация психолога для выявления триггеров',
                      'Рекомендуется когнитивно-поведенческая терапия',
                      'Необходима диагностика возможных фобий'
                    ]
                  },
                  'fear': {
                    title: 'Обнаружен страх',
                    recommendations: [
                      'Показана консультация психолога для диагностики тревожности',
                      'Рекомендуется терапия тревожных расстройств',
                      'Необходима оценка уровня стресса'
                    ]
                  },
                  'sad': {
                    title: 'Обнаружена грусть',
                    recommendations: [
                      'Требуется консультация психолога для оценки депрессивных состояний',
                      'Показана диагностика эмоционального состояния',
                      'Рекомендуется групповая психотерапия'
                    ]
                  },
                  'surprise': {
                    title: 'Обнаружено удивление',
                    recommendations: [
                      'Рекомендуется консультация психолога для оценки реакции на стресс',
                      'Показана диагностика адаптивных механизмов',
                      'Необходима оценка копинг-стратегий'
                    ]
                  },
                  'neutral': {
                    title: 'Нейтральное эмоциональное состояние',
                    recommendations: [
                      'Рекомендуется профилактическая консультация психолога',
                      'Показана оценка эмоционального интеллекта',
                      'Необходима диагностика эмоционального состояния'
                    ]
                  },
                  'happy': {
                    title: 'Обнаружена радость',
                    recommendations: [
                      'Рекомендуется консультация психолога для поддержания позитивного состояния',
                      'Показана оценка эмоционального интеллекта',
                      'Необходима диагностика эмоционального состояния'
                    ]
                  }
                };

                // Проверяем наличие эмоций в логах
                const emotionLogs = logs.filter(log => 
                  log && log.message && log.message.includes('Доминирующая эмоция:')
                );

                return (
                  <React.Fragment>
                    {Array.from(new Set(logs
                      .filter(log => log && log.type === 'night' && log.message && log.message.includes('Night mode detected'))
                      .map(log => log.message.includes('Night scene') ? 'Ночная сцена' : 'Дневная сцена')))
                      .map((scene, i) => (
                        <div key={`night-${i}`} className="detection-message night">
                          <div className="message-label" style={{
                            color: '#ffffff',
                            fontWeight: '500',
                            fontSize: '15px',
                            margin: '8px 8px 8px 0'
                          }}>Ночной режим:</div>
                          <div className="message-value">
                            <span className="object-tag" style={{
                              display: 'inline-block',
                              padding: '6px 14px',
                              backgroundColor: 'rgba(255, 255, 255, 0.2)',
                              borderRadius: '20px',
                              fontWeight: '500',
                              fontSize: '14px',
                              color: '#ffffff',
                              border: '1px solid rgba(255, 255, 255, 0.3)',
                              margin: '2px',
                              boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)'
                            }}>
                              {scene}
                            </span>
                          </div>
                        </div>
                      ))}
                    {Array.from(new Set(logs
                      .filter(log => log && log.type === 'motion' && log.message && log.message.includes('Motion detected'))
                      .map(log => 'Обнаружено движение')))
                      .map((motion, i) => (
                        <div key={`motion-${i}`} className="detection-message motion">
                          <div className="message-label" style={{
                            color: '#ffffff',
                            fontWeight: '500',
                            fontSize: '15px',
                            margin: '8px 8px 8px 0'
                          }}>Датчик движения:</div>
                          <div className="message-value" style={{
                            display: 'inline-block',
                            padding: '6px 14px',
                            backgroundColor: 'rgba(244, 67, 54, 0.2)',
                            borderRadius: '20px',
                            fontWeight: '500',
                            fontSize: '14px',
                            color: '#ffffff',
                            border: '1px solid rgba(244, 67, 54, 0.3)',
                            margin: '2px',
                            boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)'
                          }}>{motion}</div>
                        </div>
                      ))}
                    <div key="class-combined" className="detection-message objects">
                      <div className="message-label" style={{
                        color: '#ffffff',
                        fontWeight: '500',
                        fontSize: '15px',
                        margin: '8px 8px 8px 0'
                      }}>Обнаружено {allObjects.size} объектов:</div>
                      <div className="message-value">
                        {Array.from(allObjects).map((obj, j) => (
                          <span key={j} className="object-tag" style={{
                            display: 'inline-block',
                            padding: '6px 14px',
                            backgroundColor: isDangerous(obj) ? 'rgba(244, 67, 54, 0.2)' : 'rgba(255, 255, 255, 0.2)',
                            borderRadius: '20px',
                            fontWeight: '500',
                            fontSize: '14px',
                            color: '#ffffff',
                            border: `1px solid ${isDangerous(obj) ? 'rgba(244, 67, 54, 0.3)' : 'rgba(255, 255, 255, 0.3)'}`,
                            margin: '2px',
                            boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)'
                          }}>{obj}</span>
                        ))}
                      </div>
                    </div>
                    <div key="report" className={`detection-message report ${statusClass}`}>
                      <div className="message-label" style={{
                        color: '#ffffff',
                        fontWeight: '500',
                        fontSize: '15px',
                        margin: '8px 8px 8px 0'
                      }}>Отчет:</div>
                      <div className="message-value" style={{
                        display: 'block',
                        padding: '10px 14px',
                        backgroundColor: statusClass === 'danger' ? 'rgba(244, 67, 54, 0.15)' : 'rgba(76, 175, 80, 0.15)',
                        borderRadius: '10px',
                        fontSize: '14px',
                        lineHeight: '1.5',
                        color: '#ffffff',
                        border: `1px solid ${statusClass === 'danger' ? 'rgba(244, 67, 54, 0.3)' : 'rgba(76, 175, 80, 0.3)'}`,
                        margin: '2px',
                        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
                        whiteSpace: 'pre-line'
                      }}>
                        {foundDangerousObjects.length > 0 && (
                          <div>
                            <p>Обнаружены потенциально опасные объекты: {foundDangerousObjects.join(', ')}.</p>
                          </div>
                        )}

                        {isNightScene && hasMotion && (
                          <div>
                            <p>Обнаружено движение в ночное время! Возможно проникновение на охраняемую территорию или частную собственность.</p>
                          </div>
                        )}

                        {violatedLawsDetails.length > 0 && (
                          <div>
                            <p><strong>Возможные нарушения законодательства:</strong></p>
                            {violatedLawsDetails.map((law, index) => (
                              <div key={law.id} style={{ margin: '5px 0' }}>
                                <span style={{ cursor: 'pointer' }} onClick={() => toggleArticleDetails(law.id)}>
                                  <span style={{
                                    display: 'inline-block',
                                    width: '20px',
                                    height: '20px',
                                    textAlign: 'center',
                                    lineHeight: '18px',
                                    backgroundColor: 'rgba(255,255,255,0.1)',
                                    borderRadius: '50%',
                                    marginRight: '8px',
                                    border: '1px solid rgba(255,255,255,0.3)',
                                    fontSize: '14px'
                                  }}>
                                    {expandedArticles[law.id] ? '−' : '+'}
                                  </span>
                                  {index + 1}. {law.title}
                                </span>
                                {expandedArticles[law.id] && (
                                  <div style={{
                                    margin: '5px 0 10px 28px',
                                    padding: '10px 15px',
                                    backgroundColor: 'rgba(255,255,255,0.05)',
                                    borderRadius: '8px',
                                    fontSize: '13px',
                                    border: '1px solid rgba(255,255,255,0.1)'
                                  }}>
                                    <strong>Наказание:</strong> {law.punishment}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {violatedLawsDetails.length > 0 ? (
                          <p style={{ marginTop: '10px' }}><strong>Рекомендация:</strong> требуется дополнительная проверка и принятие мер компетентными органами.</p>
                        ) : (
                          <p>Потенциально опасных объектов не обнаружено. Правонарушений не выявлено.</p>
                        )}
                      </div>
                    </div>
                    {emotionLogs.length > 0 && (
                      <div className="detection-message emotions">
                        <div className="message-label" style={{
                          color: '#ffffff',
                          fontWeight: '500',
                          fontSize: '15px',
                          margin: '8px 8px 8px 0'
                        }}>Распознанные эмоции:</div>
                        <div className="message-value">
                          {(() => {
                            // Создаем объект для хранения сумм и количества для каждой эмоции
                            const emotionSums = {
                              angry: 0,
                              disgust: 0,
                              fear: 0,
                              happy: 0,
                              sad: 0,
                              surprise: 0,
                              neutral: 0
                            };
                            let frameCount = 0;

                            // Обрабатываем все логи для подсчета средних значений
                            emotionLogs.forEach(log => {
                              const lines = log.message.split('\n');
                              let hasEmotions = false;
                              
                              lines.forEach(line => {
                                // Ищем строки с процентами эмоций
                                const match = line.match(/- (\w+): ([\d.]+)%/);
                                if (match) {
                                  const [, emotion, value] = match;
                                  const emotionName = emotion.toLowerCase();
                                  if (emotionSums.hasOwnProperty(emotionName)) {
                                    const percentage = parseFloat(value);
                                    if (!isNaN(percentage)) {
                                      emotionSums[emotionName] += percentage;
                                      hasEmotions = true;
                                    }
                                  }
                                }
                              });
                              
                              if (hasEmotions) {
                                frameCount++;
                              }
                            });

                            // Вычисляем средние значения
                            const averages = {};
                            Object.keys(emotionSums).forEach(emotion => {
                              averages[emotion] = frameCount > 0 ? (emotionSums[emotion] / frameCount).toFixed(2) : 0;
                            });

                            // Находим доминирующую эмоцию
                            const dominantEmotion = Object.entries(averages)
                              .reduce((a, b) => parseFloat(a[1]) > parseFloat(b[1]) ? a : b)[0];

                            // Формируем текст с результатами
                            const emotionInfo = [
                              `Доминирующая эмоция: ${dominantEmotion}`,
                              'Детальные оценки эмоций:',
                              ...Object.entries(averages).map(([emotion, value]) => 
                                `- ${emotion}: ${value}%`
                              )
                            ].join('\n');

                            // Определяем цвет в зависимости от эмоции
                            const isNegativeEmotion = ['angry', 'disgust', 'fear', 'sad'].includes(dominantEmotion);
                            const borderColor = isNegativeEmotion ? 'rgba(244, 67, 54, 0.3)' : 'rgba(76, 175, 80, 0.3)';
                            const backgroundColor = isNegativeEmotion ? 'rgba(244, 67, 54, 0.1)' : 'rgba(76, 175, 80, 0.1)';
                            const recommendation = emotionRecommendations[dominantEmotion];

                            return (
                              <div style={{
                                marginBottom: '15px',
                                padding: '10px',
                                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                                borderRadius: '8px'
                              }}>
                                <div style={{
                                  marginTop: '8px',
                                  padding: '10px',
                                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                  borderRadius: '6px',
                                  color: '#ffffff',
                                  fontSize: '13px'
                                }}>
                                  <ul style={{
                                    margin: '0',
                                    paddingLeft: '20px',
                                    listStyleType: 'none'
                                  }}>
                                    {emotionInfo.split('\n').map((line, i) => (
                                      <li key={i} style={{ marginBottom: '4px' }}>{line}</li>
                                    ))}
                                  </ul>
                                </div>

                                {recommendation && (
                                  <div style={{
                                    marginTop: '8px',
                                    padding: '10px',
                                    backgroundColor: backgroundColor,
                                    borderRadius: '6px',
                                    border: `1px solid ${borderColor}`
                                  }}>
                                    <h4 style={{
                                      color: '#ffffff',
                                      margin: '0 0 8px 0',
                                      fontSize: '14px'
                                    }}>{recommendation.title}</h4>
                                    <ul style={{
                                      margin: '0',
                                      paddingLeft: '20px',
                                      color: '#ffffff',
                                      fontSize: '13px'
                                    }}>
                                      {recommendation.recommendations.map((rec, i) => (
                                        <li key={i} style={{ marginBottom: '4px' }}>{rec}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    )}
                  </React.Fragment>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      <RefreshButton />
    </div>
  );
}

export default MediaUpload; 