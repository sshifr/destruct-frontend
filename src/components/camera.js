import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import "../styles/Camera.css";

const baseUrl = 'http://localhost:3001';

function Camera() {
  const [cameras, setCameras] = useState([]);
  const [selectedCamera, setSelectedCamera] = useState('');
  const [selectedModel, setSelectedModel] = useState('all.pt');
  const [isProcessing, setIsProcessing] = useState(false);
  const [logs, setLogs] = useState([]);
  const [currentFrame, setCurrentFrame] = useState(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const logsContainerRef = useRef(null);
  const canvasRef = useRef(null);

  // Список доступных моделей
  const availableModels = [
    { id: 'all.pt', name: 'Модель всех объектов' },
    { id: 'violence.pt', name: 'Модель насилия' }
  ];

  // Получение списка доступных камер
  useEffect(() => {
    async function getCameras() {
      console.log('Getting list of cameras...');
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        console.log('All devices:', devices);
        
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        console.log('Video devices:', videoDevices);
        
        // Запрашиваем разрешение на доступ к камере для получения меток
        try {
          await navigator.mediaDevices.getUserMedia({ video: true });
        } catch (error) {
          console.log('Camera permission denied:', error);
        }
        
        // Повторно получаем список устройств, теперь с метками
        const updatedDevices = await navigator.mediaDevices.enumerateDevices();
        const updatedVideoDevices = updatedDevices.filter(device => device.kind === 'videoinput');
        
        setCameras(updatedVideoDevices);
        if (updatedVideoDevices.length > 0) {
          console.log('Setting default camera:', updatedVideoDevices[0].deviceId);
          setSelectedCamera(updatedVideoDevices[0].deviceId);
          // Запускаем видео с выбранной камерой
          startVideoStream(updatedVideoDevices[0].deviceId);
        } else {
          console.log('No video devices found');
          setLogs(prev => [...prev, { 
            message: 'Камеры не найдены. Пожалуйста, проверьте подключение камеры и разрешения браузера.', 
            type: 'error' 
          }]);
        }
      } catch (error) {
        console.error('Error getting camera list:', error);
        setLogs(prev => [...prev, { 
          message: `Ошибка при получении списка камер: ${error.message}`, 
          type: 'error' 
        }]);
      }
    }
    getCameras();
  }, []);

  // Функция для запуска видеопотока
  const startVideoStream = async (deviceId) => {
    try {
      // Останавливаем текущий поток, если он есть
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId } }
      });
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
      }
    } catch (error) {
      console.error('Error starting video stream:', error);
      setLogs(prev => [...prev, { 
        message: `Ошибка при запуске видеопотока: ${error.message}`, 
        type: 'error' 
      }]);
    }
  };

  // Обработка изменения выбранной камеры
  const handleCameraChange = async (event) => {
    const deviceId = event.target.value;
    setSelectedCamera(deviceId);
    await startVideoStream(deviceId);
  };

  // Функция для отрисовки кадра с боксами
  const drawFrame = (imageData) => {
    if (!canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    // Создаем изображение из base64
    const img = new Image();
    img.onload = () => {
      // Устанавливаем размеры canvas равными размерам изображения
      canvas.width = img.width;
      canvas.height = img.height;
      
      // Очищаем canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Рисуем изображение
      ctx.drawImage(img, 0, 0);
    };
    img.src = `data:image/jpeg;base64,${imageData}`;
  };

  // Запуск анализа
  const handleStartClick = async () => {
    console.log('Start button clicked');
    console.log('Selected camera:', selectedCamera);
    console.log('Selected model:', selectedModel);
    
    if (!selectedCamera || isProcessing) {
      console.log('Cannot start: no camera selected or already processing');
      return;
    }

    setIsProcessing(true);
    setLogs([]);

    try {
      console.log('Sending request to start camera analysis...');
      const response = await fetch(`${baseUrl}/start-camera-analysis?model=${selectedModel}&cameraId=${selectedCamera}`);
      console.log('Response received:', response);
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log('Stream complete');
          break;
        }

        const chunk = decoder.decode(value);
        console.log('Received chunk:', chunk);
        buffer += chunk;

        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep the last incomplete line in the buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const jsonStr = line.slice(6).trim();
              if (!jsonStr) continue; // Skip empty lines
              
              const data = JSON.parse(jsonStr);
              console.log('Parsed data:', data);
              
              if (data.status === 'frame' && data.image) {
                // Обновляем текущий кадр
                setCurrentFrame(data.image);
                // Отрисовываем кадр с боксами
                drawFrame(data.image);
                // Добавляем лог
                setLogs(prev => [...prev, { 
                  message: 'Получен новый кадр', 
                  type: 'info'
                }]);
              } else {
                // Handle other types of messages
                setLogs(prev => [...prev, { 
                  message: data.message, 
                  type: data.type || 'info' 
                }]);
              }
            } catch (e) {
              console.error('Error parsing SSE data:', e, 'Raw line:', line);
              setLogs(prev => [...prev, { 
                message: `Ошибка обработки данных: ${e.message}`, 
                type: 'error' 
              }]);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error starting analysis:', error);
      setLogs(prev => [...prev, { message: `Ошибка: ${error.message}`, type: 'error' }]);
    } finally {
      setIsProcessing(false);
    }
  };

  // Остановка анализа
  const handleStopClick = async () => {
    try {
      await axios.get(`${baseUrl}/stop-camera-analysis`);
      setIsProcessing(false);
      setLogs(prev => [...prev, { message: 'Анализ остановлен', type: 'info' }]);
    } catch (error) {
      console.error('Ошибка при остановке анализа:', error);
      setLogs(prev => [...prev, { message: `Ошибка при остановке: ${error.message}`, type: 'error' }]);
    }
  };

  // Прокрутка логов вниз
  useEffect(() => {
    if (logsContainerRef.current) {
      const logsElement = logsContainerRef.current.querySelector('.logs');
      if (logsElement) {
        logsElement.scrollTop = logsElement.scrollHeight;
      }
    }
  }, [logs]);

  return (
    <div className="camera-component">
      <div className="camera-controls">
        <div className="camera-select">
          <label htmlFor="cameraSelect">Выберите камеру:</label>
          <select
            id="cameraSelect"
            value={selectedCamera}
            onChange={handleCameraChange}
            disabled={isProcessing}
          >
            {cameras.map((camera) => (
              <option key={camera.deviceId} value={camera.deviceId}>
                {camera.label || `Камера ${camera.deviceId.slice(0, 5)}...`}
              </option>
            ))}
          </select>
        </div>

        <div className="model-select">
          <label htmlFor="modelSelect">Выберите модель:</label>
          <select
            id="modelSelect"
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            disabled={isProcessing}
          >
            {availableModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="video-container">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="camera-feed"
        />
        <canvas
          ref={canvasRef}
          className="detection-canvas"
        />
      </div>

      <div className="buttons-container">
        <button
          className={`button ${isProcessing ? 'button-disabled' : ''}`}
          onClick={handleStartClick}
          disabled={isProcessing}
        >
          Начать
        </button>
        {isProcessing && (
          <button className="button stop-button" onClick={handleStopClick}>
            Остановить
          </button>
        )}
      </div>

      {logs.length > 0 && (
        <div className="logs-container" ref={logsContainerRef}>
          <h3>Результаты анализа:</h3>
          <div className="logs">
            {logs.map((log, index) => (
              <div key={index} className={`log-line log-${log.type}`}>
                {log.message}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default Camera;
