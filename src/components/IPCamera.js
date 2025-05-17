import React, { useState, useRef, useEffect, useCallback } from 'react';
import '../styles/IPCamera.css';

const IPCamera = () => {
    const [selectedModel, setSelectedModel] = useState('all.pt');
    const [isProcessing, setIsProcessing] = useState(false);
    const [logs, setLogs] = useState([]);
    const [rtspUrl, setRtspUrl] = useState('');
    const [motionDetection, setMotionDetection] = useState(false);
    const [nightMode, setNightMode] = useState(false);
    const canvasRef = useRef(null);
    const logsContainerRef = useRef(null);

    const models = [
        { id: 'all.pt', name: 'Модель всех объектов' },
        { id: 'violence.pt', name: 'Модель насилия' }
    ];

    const addLog = (message, type = 'info') => {
        setLogs(prevLogs => [...prevLogs, { message, type, timestamp: new Date().toISOString() }]);
    };

    const drawFrame = (imageData) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const img = new Image();
        
        img.onload = () => {
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);
        };
        
        img.src = `data:image/jpeg;base64,${imageData}`;
    };

    const startAnalysis = async () => {
        if (!rtspUrl) {
            addLog('Пожалуйста, введите RTSP URL', 'error');
            return;
        }

        setIsProcessing(true);
        addLog('Запуск анализа...');
        addLog(`Параметры: ночной режим = ${nightMode}, датчик движения = ${motionDetection}`);

        try {
            const params = new URLSearchParams({
                model: selectedModel,
                rtspUrl: rtspUrl,
                motionDetection: motionDetection.toString(),
                nightMode: nightMode.toString()
            });
            
            const url = `/api/start-ip-camera?${params.toString()}`;
            console.log('Requesting URL:', url);
            
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'text/event-stream'
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('Server response:', errorText);
                throw new Error(`Ошибка запуска анализа: ${response.status} ${response.statusText}\nПроверьте, что сервер запущен на порту 3001`);
            }

            if (!response.headers.get('content-type')?.includes('text/event-stream')) {
                throw new Error('Неверный тип ответа от сервера. Ожидается text/event-stream');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || ''; // Оставляем последнюю неполную строку в буфере

                for (const line of lines) {
                    if (!line.trim()) continue;
                    
                    // Проверяем, что строка начинается с "data: "
                    if (line.startsWith('data: ')) {
                        try {
                            const jsonStr = line.slice(6); // Убираем "data: " из начала строки
                            const data = JSON.parse(jsonStr);
                            console.log('Parsed data:', data);
                            
                            switch (data.status) {
                                case 'info':
                                    addLog(data.message);
                                    break;
                                case 'warning':
                                    addLog(data.message, 'warning');
                                    break;
                                case 'error':
                                    addLog(data.message, 'error');
                                    break;
                                case 'frame':
                                    drawFrame(data.image);
                                    break;
                                default:
                                    console.log('Unknown status:', data.status);
                                    break;
                            }
                        } catch (e) {
                            console.error('Error parsing line:', line);
                            console.error('Parse error:', e);
                            addLog(`Ошибка обработки данных: ${e.message}`, 'error');
                        }
                    } else {
                        console.log('Skipping non-data line:', line);
                    }
                }
            }
        } catch (error) {
            console.error('Full error:', error);
            addLog(`Ошибка: ${error.message}`, 'error');
        } finally {
            setIsProcessing(false);
        }
    };

    const stopAnalysis = useCallback(async () => {
        try {
            const response = await fetch('/api/stop-ip-camera', {
                method: 'GET'
            });

            if (!response.ok) {
                throw new Error('Ошибка остановки анализа');
            }

            addLog('Анализ остановлен');
            setIsProcessing(false);
        } catch (error) {
            addLog(`Ошибка при остановке: ${error.message}`, 'error');
        }
    }, []);

    useEffect(() => {
        return () => {
            if (isProcessing) {
                stopAnalysis();
            }
        };
    }, [isProcessing, stopAnalysis]);

    // Прокрутка логов вниз при появлении новых
    useEffect(() => {
        if (logsContainerRef.current) {
            logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
        }
    }, [logs]);

    return (
        <div className="ip-camera-container">
            <div className="ip-camera-video-container">
                <canvas ref={canvasRef} className="ip-camera-feed" />
            </div>

            <div className="ip-camera-controls">
                <div className="ip-camera-model-select">
                    <label>Модель:</label>
                    <select
                        value={selectedModel}
                        onChange={(e) => setSelectedModel(e.target.value)}
                        disabled={isProcessing}
                    >
                        {models.map(model => (
                            <option key={model.id} value={model.id}>
                                {model.name}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="ip-camera-rtsp-input">
                    <label>RTSP URL:</label>
                    <input
                        type="text"
                        value={rtspUrl}
                        onChange={(e) => setRtspUrl(e.target.value)}
                        placeholder="rtsp://..."
                        disabled={isProcessing}
                    />
                </div>

                <div className="ip-camera-mode-controls">
                    <label className="ip-camera-mode-checkbox">
                        <input
                            type="checkbox"
                            checked={motionDetection}
                            onChange={(e) => setMotionDetection(e.target.checked)}
                            disabled={isProcessing}
                        />
                        Датчик движения
                    </label>

                    <label className="ip-camera-mode-checkbox">
                        <input
                            type="checkbox"
                            checked={nightMode}
                            onChange={(e) => setNightMode(e.target.checked)}
                            disabled={isProcessing}
                        />
                        Ночной режим
                    </label>
                </div>

                <div className="ip-camera-buttons">
                    <button
                        className="ip-camera-start-button"
                        onClick={startAnalysis}
                        disabled={isProcessing || !rtspUrl}
                    >
                        Начать анализ
                    </button>

                    <button
                        className="ip-camera-stop-button"
                        onClick={stopAnalysis}
                        disabled={!isProcessing}
                    >
                        Остановить анализ
                    </button>
                </div>
            </div>

            <div className="ip-camera-logs-container" ref={logsContainerRef}>
                <h3>Логи анализа:</h3>
                <div className="ip-camera-logs">
                    {logs.map((log, index) => (
                        <div key={index} className={`ip-camera-log ip-camera-log-${log.type}`}>
                            {new Date(log.timestamp).toLocaleTimeString()} - {log.message}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default IPCamera; 