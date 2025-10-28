import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import fs from "fs";
import unzipper from "unzipper";
import os from "os";
import { exec, spawn } from "child_process";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8089;

// Configuration for game server
const GAME_CONFIG = {
  // Path where games will be generated on the server
  GAME_PATH: path.join(__dirname, "generated_games", "current_game"),
  // Port for backend (will be proxied by nginx)
  BACKEND_PORT: 5000,
  // Port for frontend (will be proxied by nginx)
  FRONTEND_PORT: 5173,
  // Template zip file location
  TEMPLATE_PATH: path.join(__dirname, "files", "ReactNodeTemplate.zip"),
};

// Get API key from .env file
const XAI_API_KEY = process.env.secret;

app.use(express.json());
app.use(express.static(__dirname));

// Store running game processes
let gameProcesses = {
  backend: null,
  frontend: null,
};

// === Helper Functions ===

/**
 * Kill existing game processes
 */
function killGameProcesses() {
  return new Promise((resolve) => {
    const promises = [];

    // Kill backend process
    if (gameProcesses.backend) {
      promises.push(
        new Promise((res) => {
          exec(
            `lsof -ti:${GAME_CONFIG.BACKEND_PORT} | xargs kill -9`,
            (err) => {
              if (err) console.log("No backend process to kill");
              gameProcesses.backend = null;
              res();
            }
          );
        })
      );
    }

    // Kill frontend process
    if (gameProcesses.frontend) {
      promises.push(
        new Promise((res) => {
          exec(
            `lsof -ti:${GAME_CONFIG.FRONTEND_PORT} | xargs kill -9`,
            (err) => {
              if (err) console.log("No frontend process to kill");
              gameProcesses.frontend = null;
              res();
            }
          );
        })
      );
    }

    Promise.all(promises).then(() => {
      console.log("All game processes killed");
      resolve();
    });
  });
}

/**
 * Delete existing game folder
 */
function deleteGameFolder() {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(GAME_CONFIG.GAME_PATH)) {
      fs.rm(GAME_CONFIG.GAME_PATH, { recursive: true, force: true }, (err) => {
        if (err) {
          console.error("Failed to delete game folder:", err);
          reject(err);
        } else {
          console.log("Game folder deleted successfully");
          resolve();
        }
      });
    } else {
      resolve();
    }
  });
}

/**
 * Unzip template to game folder
 */
function unzipTemplate() {
  return new Promise((resolve, reject) => {
    const parentDir = path.dirname(GAME_CONFIG.GAME_PATH);
    fs.mkdirSync(parentDir, { recursive: true });

    fs.createReadStream(GAME_CONFIG.TEMPLATE_PATH)
      .pipe(
        unzipper.Extract({
          path: GAME_CONFIG.GAME_PATH + "_temp",
        })
      )
      .on("close", () => {
        // Move files from ReactNodeTemplate subfolder to current_game
        const templateFolder = path.join(
          GAME_CONFIG.GAME_PATH + "_temp",
          "ReactNodeTemplate"
        );
        if (fs.existsSync(templateFolder)) {
          fs.renameSync(templateFolder, GAME_CONFIG.GAME_PATH);
          fs.rmSync(GAME_CONFIG.GAME_PATH + "_temp", {
            recursive: true,
            force: true,
          });
        } else {
          fs.renameSync(GAME_CONFIG.GAME_PATH + "_temp", GAME_CONFIG.GAME_PATH);
        }
        console.log("Template unzipped successfully");
        resolve();
      })
      .on("error", reject);
  });
}

/**
 * Install npm dependencies
 */
function installDependencies(projectPath) {
  return new Promise((resolve, reject) => {
    console.log(`Installing dependencies in ${projectPath}...`);
    exec("npm install", { cwd: projectPath }, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error installing dependencies: ${error.message}`);
        reject(error);
      } else {
        console.log(`Dependencies installed in ${projectPath}`);
        resolve();
      }
    });
  });
}

/**
 * Start backend server
 */
function startBackend() {
  return new Promise((resolve, reject) => {
    const backendPath = path.join(GAME_CONFIG.GAME_PATH, "backend");

    console.log("Starting backend server...");
    const backendProcess = spawn("npm", ["run", "dev"], {
      cwd: backendPath,
      env: { ...process.env, PORT: GAME_CONFIG.BACKEND_PORT },
      detached: false,
      stdio: "inherit",
    });

    gameProcesses.backend = backendProcess;

    backendProcess.on("error", (err) => {
      console.error("Backend process error:", err);
      reject(err);
    });

    // Wait a bit for the server to start
    setTimeout(() => {
      console.log(`Backend started on port ${GAME_CONFIG.BACKEND_PORT}`);
      resolve();
    }, 3000);
  });
}

/**
 * Start frontend server
 */
function startFrontend() {
  return new Promise((resolve, reject) => {
    const frontendPath = path.join(GAME_CONFIG.GAME_PATH, "frontend");

    console.log("Starting frontend server...");
    const frontendProcess = spawn("npm", ["run", "dev"], {
      cwd: frontendPath,
      env: { ...process.env, PORT: GAME_CONFIG.FRONTEND_PORT },
      detached: false,
      stdio: "inherit",
    });

    gameProcesses.frontend = frontendProcess;

    frontendProcess.on("error", (err) => {
      console.error("Frontend process error:", err);
      reject(err);
    });

    // Wait a bit for the server to start
    setTimeout(() => {
      console.log(`Frontend started on port ${GAME_CONFIG.FRONTEND_PORT}`);
      resolve();
    }, 3000);
  });
}

// === Routes ===

// index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// static files
app.get("/logo", (req, res) => {
  res.sendFile(path.join(__dirname, "images", "Blue (Gradient).png"));
});

app.get("/gif", (req, res) => {
  console.log("Hi");
  res.sendFile(path.join(__dirname, "images", "0910.gif"));
});

app.get("/fullscreenlogo", (req, res) => {
  res.sendFile(path.join(__dirname, "images", "expand.svg"));
});

// chat endpoint
app.post("/chat", async (req, res) => {
  const { messages } = req.body;
  console.log(messages);

  if (!messages) {
    return res.status(400).json({ error: "messages array required" });
  }

  const payload = {
    model: "grok-3",
    messages,
    max_tokens: 6000,
    temperature: 0.7,
  };

  try {
    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${XAI_API_KEY}`,
      },
      body: JSON.stringify(payload),
      timeout: 120000,
    });

    const text = await response.text();
    res.status(response.status).type("application/json").send(text);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "request failed", detail: err.message });
  }
});

// Save index.html
app.post("/save-html", (req, res) => {
  const { content } = req.body;
  if (!content) {
    return res.status(400).json({ error: "No content provided" });
  }

  const filePath = path.join(GAME_CONFIG.GAME_PATH, "index.html");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");

  res.json({ success: true, path: filePath });
});

// Save App.jsx
app.post("/save-appjsx", (req, res) => {
  const { content } = req.body;
  if (!content) {
    return res.status(400).json({ error: "No content provided" });
  }

  const filePath = path.join(
    GAME_CONFIG.GAME_PATH,
    "frontend",
    "src",
    "App.jsx"
  );
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");

  res.json({ success: true, path: filePath });
});

// Save server.js
app.post("/save-serverjs", (req, res) => {
  const { content } = req.body;
  if (!content) {
    return res.status(400).json({ error: "No content provided" });
  }

  const filePath = path.join(GAME_CONFIG.GAME_PATH, "backend", "server.js");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");

  res.json({ success: true, path: filePath });
});

// Save logicofgame.js
app.post("/save-logicofgamejs", (req, res) => {
  const { content } = req.body;
  if (!content) {
    return res.status(400).json({ error: "No content provided" });
  }

  const filePath = path.join(
    GAME_CONFIG.GAME_PATH,
    "backend",
    "logicofgame.js"
  );
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");

  res.json({ success: true, path: filePath });
});

// Initialize new game (extract template)
app.post("/initialize-game", async (req, res) => {
  try {
    console.log("Initializing new game...");

    // Step 1: Kill existing processes
    await killGameProcesses();

    // Step 2: Delete existing game folder
    await deleteGameFolder();

    // Step 3: Unzip template
    await unzipTemplate();

    res.json({
      success: true,
      message: "Game initialized successfully",
      path: GAME_CONFIG.GAME_PATH,
    });
  } catch (error) {
    console.error("Error initializing game:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Start game servers (backend and frontend)
app.post("/start-game", async (req, res) => {
  try {
    console.log("Starting game servers...");

    const backendPath = path.join(GAME_CONFIG.GAME_PATH, "backend");
    const frontendPath = path.join(GAME_CONFIG.GAME_PATH, "frontend");

    // Install dependencies
    await installDependencies(backendPath);
    await installDependencies(frontendPath);

    // Start servers
    await startBackend();
    await startFrontend();

    res.json({
      success: true,
      message: "Game servers started successfully",
      ports: {
        backend: GAME_CONFIG.BACKEND_PORT,
        frontend: GAME_CONFIG.FRONTEND_PORT,
      },
      urls: {
        backend: `http://localhost:${GAME_CONFIG.BACKEND_PORT}`,
        frontend: `http://localhost:${GAME_CONFIG.FRONTEND_PORT}`,
      },
    });
  } catch (error) {
    console.error("Error starting game:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Stop game servers
app.post("/stop-game", async (req, res) => {
  try {
    await killGameProcesses();
    res.json({
      success: true,
      message: "Game servers stopped successfully",
    });
  } catch (error) {
    console.error("Error stopping game:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Get game status
app.get("/game-status", (req, res) => {
  res.json({
    success: true,
    running: {
      backend: gameProcesses.backend !== null,
      frontend: gameProcesses.frontend !== null,
    },
    ports: {
      backend: GAME_CONFIG.BACKEND_PORT,
      frontend: GAME_CONFIG.FRONTEND_PORT,
    },
    path: GAME_CONFIG.GAME_PATH,
  });
});

// Generate game endpoint (combines initialize and start)
app.post("/generate-game", async (req, res) => {
  try {
    console.log("Generating new game...");

    // Step 1: Kill existing processes
    await killGameProcesses();

    // Step 2: Delete existing game folder
    await deleteGameFolder();

    // Step 3: Unzip template
    await unzipTemplate();

    // Step 4: Install dependencies and start servers
    const backendPath = path.join(GAME_CONFIG.GAME_PATH, "backend");
    const frontendPath = path.join(GAME_CONFIG.GAME_PATH, "frontend");

    await installDependencies(backendPath);
    await installDependencies(frontendPath);

    await startBackend();
    await startFrontend();

    res.json({
      success: true,
      message: "Game generated and started successfully",
      ports: {
        backend: GAME_CONFIG.BACKEND_PORT,
        frontend: GAME_CONFIG.FRONTEND_PORT,
      },
      urls: {
        backend: `http://localhost:${GAME_CONFIG.BACKEND_PORT}`,
        frontend: `http://localhost:${GAME_CONFIG.FRONTEND_PORT}`,
        // If using nginx proxy
        game: `http://yourdomain.com/game`,
      },
    });
  } catch (error) {
    console.error("Error generating game:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

let gameSessionUuid = 218;
app.post("/get2links", (req, res) => {
  gameSessionUuid = gameSessionUuid + 1;
  try {
    const request = {
      room: {
        name: "ProductionRoom",
        gameSessionUuid: gameSessionUuid,
        coinBetAmount: 50,
      },
      players: [
        {
          name: "Player1",
          uuid: "uuid_1",
          profileImage:
            "https://safa.sgp1.digitaloceanspaces.com/safa./avatar_images/Kaelani_M.png",
          ready: true,
        },
        {
          name: "Player2",
          uuid: "uuid_2",
          profileImage:
            "https://safa.sgp1.digitaloceanspaces.com/safa./avatar_images/Zayven_M.png",
          ready: true,
        },
      ],
    };

    const baseUrl = `http://localhost:${GAME_CONFIG.FRONTEND_PORT}`;
    const gameStateId = "68f5bddd86748a2b6dfa746c";

    const payload = {
      gameSessionUuid: request.room.gameSessionUuid,
      gameStateId,
      name: request.room.name,
      createDate: new Date().toISOString(),
      link1: `${baseUrl}/?gameSessionUuid=${request.room.gameSessionUuid}&gameStateId=${gameStateId}&uuid=${request.players[0].uuid}`,
      link2: `${baseUrl}/?gameSessionUuid=${request.room.gameSessionUuid}&gameStateId=${gameStateId}&uuid=${request.players[1].uuid}`,
    };

    return res.json({
      status: true,
      message: "success",
      payload,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      status: false,
      message: "error generating links",
    });
  }
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("Shutting down gracefully...");
  await killGameProcesses();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("Shutting down gracefully...");
  await killGameProcesses();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Game will run on:`);
  console.log(`  - Backend: http://localhost:${GAME_CONFIG.BACKEND_PORT}`);
  console.log(`  - Frontend: http://localhost:${GAME_CONFIG.FRONTEND_PORT}`);
});
