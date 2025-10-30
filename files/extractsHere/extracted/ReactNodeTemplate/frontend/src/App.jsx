javascript
import React, { useEffect, useRef, useState } from "react";
import checkpointSoundFile from "../public/sounds/checkpoint.mp3";
import crashSoundFile from "../public/sounds/crash.mp3";
import "./App.css";

export default function App() {
  const canvasRef = useRef(null);
  const [log, setLog] = useState([]);
  const wsRef = useRef(null);
  const prevStateRef = useRef({
    cars: [{ score: 0 }, { score: 0 }],
    checkpoint: { x: -1, y: -1 },
  });

  const appendLog = (msg) => setLog((prev) => [...prev, msg]);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const gameSessionUuid = urlParams.get("gameSessionUuid");
    const playerUuid = urlParams.get("uuid");

    const ws = new WebSocket(`wss://aigameb.gameonworld.ai/socket`);
    wsRef.current = ws;

    const checkpointSound = new Audio(checkpointSoundFile);
    const crashSound = new Audio(crashSoundFile);

    ws.addEventListener("open", () => {
      appendLog("✅ Connected to WebSocket server");
      if (gameSessionUuid && playerUuid) {
        ws.send(
          JSON.stringify({
            type: "joinGame",
            gameSessionUuid,
            playerUuid,
          })
        );
      }
    });

    ws.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case "joined":
            appendLog(`Joined as ${msg.role} (${msg.playerNum || "spectator"})`);
            break;
          case "state":
            handleState(msg.data, checkpointSound, crashSound);
            break;
          case "error":
            appendLog(`❌ Error: ${msg.message}`);
            break;
          case "gameStarted":
            appendLog("🎮 Race started!");
            break;
          case "gameStopped":
            appendLog("🛑 Race stopped!");
            break;
          case "gameOver":
            appendLog(`🏆 ${msg.message}`);
            drawGameOver(msg.message);
            break;
          default:
            console.log("Unknown message:", msg);
        }
      } catch (e) {
        console.error("Bad message:", e);
      }
    });

    ws.addEventListener("close", () => appendLog("⚠️ Disconnected"));

    const ctx = canvasRef.current.getContext("2d");
    const resize = () => {
      const s = Math.min(window.innerWidth * 0.9, window.innerHeight * 0.7, 720);
      canvasRef.current.width = Math.floor(s);
      canvasRef.current.height = Math.floor(s);
    };
    resize();
    window.addEventListener("resize", resize);

    function handleState(state, checkpointSound, crashSound) {
      const prevState = prevStateRef.current;
      if (state.cars && Array.isArray(state.cars)) {
        state.cars.forEach((car, index) => {
          if (!car || !car.position) return;
          if (!prevState.cars || !prevState.cars[index]) return;

          // Play sound when a checkpoint is reached
          if (car.score > prevState.cars[index].score) {
            checkpointSound.play().catch(console.error);
          }

          // Play crash sound if cars collide (detected by position reset)
          const initialPositions = [{ x: 5, y: 5 }, { x: 15, y: 15 }];
          if (
            car.position.x === initialPositions[index].x &&
            car.position.y === initialPositions[index].y &&
            prevState.cars[index].position.x !== initialPositions[index].x &&
            prevState.cars[index].position.y !== initialPositions[index].y
          ) {
            crashSound.play().catch(console.error);
          }
        });
        prevStateRef.current = {
          cars: state.cars.map((c) => ({
            score: c?.score || 0,
            position: c?.position || { x: -1, y: -1 },
          })),
          checkpoint: { ...(state.checkpoint || { x: -1, y: -1 }) },
        };
      }
      draw(ctx, state);
    }

    function draw(ctx, state) {
      if (!state) return;
      const grid = state.grid || 20;
      const cell = canvasRef.current.width / grid;
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);

      // Draw cars with green theme
      ctx.fillStyle = "#2ecc71"; // Green color for cars
      for (const c of state.cars || []) {
        if (!c.position) continue;
        ctx.fillRect(c.position.x * cell, c.position.y * cell, cell - 2, cell - 2);
        if (c.name) {
          ctx.fillStyle = "#ffffff";
          ctx.font = "12px Arial";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(c.name, c.position.x * cell + cell / 2, c.position.y * cell + cell / 2);
        }
      }

      // Draw checkpoint
      if (state.checkpoint) {
        ctx.fillStyle = "#f1c40f"; // Yellow for checkpoint
        ctx.beginPath();
        ctx.arc(
          state.checkpoint.x * cell + cell / 2,
          state.checkpoint.y * cell + cell / 2,
          cell / 2 - 1,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }

      // Draw scores and timer
      ctx.fillStyle = "#ffffff";
      ctx.font = "16px Arial";
      ctx.textAlign = "left";
      if (state.cars && state.cars[0]) 
        ctx.fillText(`${state.cars[0].name}: ${state.cars[0].score}`, 10, 10);
      ctx.textAlign = "right";
      if (state.cars && state.cars[1]) 
        ctx.fillText(`${state.cars[1].name}: ${state.cars[1].score}`, canvasRef.current.width - 10, 10);

      ctx.textAlign = "center";
      if (state.countdown > 0) {
        ctx.font = "48px Arial";
        ctx.fillText(Math.ceil(state.countdown).toString(), canvasRef.current.width / 2, canvasRef.current.height / 2);
      } else {
        ctx.fillText(`Time: ${Math.ceil(state.timer)}s`, canvasRef.current.width / 2, 10);
      }
    }

    function drawGameOver(message) {
      const ctx = canvasRef.current.getContext("2d");
      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      ctx.fillStyle = "#ffffff";
      ctx.font = "24px Arial";
      ctx.textAlign = "center";
      ctx.fillText("Race Over", canvasRef.current.width / 2, canvasRef.current.height / 2 - 20);
      ctx.fillText(message, canvasRef.current.width / 2, canvasRef.current.height / 2 + 20);
    }

    return () => {
      ws.close();
      window.removeEventListener("resize", resize);
    };
  }, []);

  // Controls for steering the car
  const sendSteer = (dir) => {
    wsRef.current?.send(JSON.stringify({ type: "steer", data: dir }));
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "10px",
        padding: "14px",
        background: "#0b1020",
        minHeight: "100vh",
        color: "#e5e7eb",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          background: "#0f172a",
          border: "1px solid #1f2937",
          width: "min(90vmin, 720px)",
          height: "min(90vmin, 720px)",
          imageRendering: "pixelated",
        }}
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 60px)",
          gridTemplateRows: "repeat(2, 60px)",
          gap: "5px",
        }}
      >
        <button className="control-btn" id="up-btn" style={{ gridColumn: 2, gridRow: 1 }} onClick={() => sendSteer({ x: 0, y: -1 })}>
          ↑
        </button>
        <button className="control-btn" id="left-btn" style={{ gridColumn: 1, gridRow: 2 }} onClick={() => sendSteer({ x: -1, y: 0 })}>
          ←
        </button>
        <button className="control-btn" id="right-btn" style={{ gridColumn: 3, gridRow: 2 }} onClick={() => sendSteer({ x: 1, y: 0 })}>
          →
        </button>
        <button className="control-btn" id="down-btn" style={{ gridColumn: 2, gridRow: 2 }} onClick={() => sendSteer({ x: 0, y: 1 })}>
          ↓
        </button>
      </div>

      <div id="log" style={{ fontSize: "14px", marginTop: "10px", textAlign: "center" }}>
        {log.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </div>
  );
}