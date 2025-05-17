import "./App.css";
import Background from "./components/animation";
import MediaUpload from "./components/MediaUpload";
import Audio from "./components/audio";
import Camera from "./components/camera";
import IPCamera from "./components/IPCamera";

function App() {
  return (
    <div className="App">
      <Background />
      <MediaUpload />
      <Audio />
      <Camera />
      <IPCamera />
    </div>
  );
}

export default App;