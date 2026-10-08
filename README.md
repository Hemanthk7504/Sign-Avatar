# Generative 3D Sign Language Avatar Synthesis

Full-stack **Generative 3D Sign Language Avatar Synthesis** application featuring a **FastAPI** real-time motion synthesis backend and a **Next.js 14 + React Three Fiber (Three.js)** 3D Signing Studio frontend.

Converts free-form **text** or **live speech** into **linguistic sign glosses** and synthesizes **3D skeletal motion** streamed in real time over WebSockets to full-body 3D human interpreters, complete with a synchronized biomechanical landmark overlay and quantitative evaluation suite.

> **Runs entirely on CPU. No GPU required — including diffusion model training and real-time inference.**

---

## Key Features

| Feature | Description |
|---|---|
| **Dual Motion Engines** | **1. Neural Diffusion (`diffusion`)**: Conditional Transformer DDPM/DDIM over a 66-point 3D body/hand/face layout for **bilateral (two-handed)** signing.<br>**2. S2S Capture (`s2s`)**: Real MediaPipe Holistic 178-point human motion capture for crisp dominant-hand fingerspelling and lexicon lookup. |
| **3D Humanoid Avatars** | **Human Interpreter (Michelle)** and **Ready Player Me (Alex)** with analytical Two-Bone Inverse Kinematics (IK), anatomical pole vectors, finger phalanx articulation, and facial morph targets. |
| **Biomechanical Overlay** | Real-time 3D diagnostic skeleton overlay (shoulders, elbows, 21-joint hands, and 16-point facial markers) calibrated to the active avatar's proportions. |
| **Speech & Text Input** | Live text-to-sign streaming plus a dual-engine **Hold-to-Talk** speech recognizer (native browser Web Speech API + 16kHz Auto-Gain PCM WAV fallback). |
| **Temporal Smoothing** | Savitzky-Golay trajectory filtering on the backend paired with per-joint **One-Euro Filters** on the frontend for jitter-free 25–60 FPS motion. |
| **Evaluation Suite** | Quantitative metrics (**APE**, **DTW**, **Jerk Ratio**, **Diversity**) and an IRB-ready human intelligibility & comprehension study interface. |

---

## 1. Prerequisites (What to Install First)

Make sure the following software is installed on your machine before setting up the project:

1. **Python 3.10 or 3.11 (64-bit)**
   - Download from [python.org](https://www.python.org/downloads/)
   - Ensure **"Add Python to PATH"** is checked during installation on Windows.
2. **Node.js (v18.17+ or v20+ LTS) & npm**
   - Download from [nodejs.org](https://nodejs.org/)
   - Verify with `node -v` and `npm -v`.
3. **Git**
   - Download from [git-scm.com](https://git-scm.com/)
   - Required because `pip` installs the `spoken-to-signed` package directly from GitHub.
4. **FFmpeg *(Optional)***
   - Only required if you upload compressed `.webm`/`.ogg`/`.mp3` files to the REST speech endpoint. The live Studio microphone records 16kHz linear PCM WAV / Web Speech directly in the browser and **does not require FFmpeg**.

---

## 2. Installation Guide

### Step 1: Clone or Open the Repository

```bash
cd sign_avatar_app/sign_avatar
```

---

### Step 2: Backend Setup (Python Virtual Environment)

#### On Windows (PowerShell):
```powershell
# 1. Create a virtual environment
python -m venv .venv

# 2. Activate the virtual environment
.\.venv\Scripts\Activate.ps1

# 3. Upgrade pip and install all backend dependencies
python -m pip install --upgrade pip
pip install -r requirements.txt
```

#### On macOS / Linux (Bash/Zsh):
```bash
# 1. Create and activate virtual environment
python3 -m venv .venv
source .venv/bin/activate

# 2. Upgrade pip and install all backend dependencies
pip install --upgrade pip
pip install -r requirements.txt
```

#### Python Packages Installed (`requirements.txt`):
| Package | Purpose |
|---|---|
| `fastapi>=0.115.0`, `uvicorn[standard]>=0.30.6` | ASGI web server, REST endpoints, and real-time WebSocket streaming |
| `pydantic>=2.9.2`, `python-multipart>=0.0.9`, `jinja2>=3.1.4` | Schema validation, file uploads, and server templates |
| `torch>=2.0` | PyTorch CPU engine for the Transformer diffusion model (`MotionDenoiser`) |
| `numpy>=1.26.4`, `scipy>=1.13.1` | 3D coordinate math and Savitzky-Golay temporal smoothing |
| `pose-format>=0.4.1`, `simplemma>=1.0.0` | 3D MediaPipe Holistic `.pose` handling and lemmatization |
| `spoken-to-signed` *(from GitHub)* | Real captured human sign language fingerspelling & lexicon pipeline |
| `SpeechRecognition>=3.10.4`, `pydub>=0.25.1`, `sherpa-onnx>=1.13.0` | Speech-to-text audio transcription |

---

### Step 3: Frontend Setup (Next.js 3D Studio)

Open a terminal in the project root and install the Node.js dependencies inside the `frontend` directory:

```bash
cd frontend
npm install
cd ..
```

#### Frontend Packages Installed (`frontend/package.json`):
- **Core Framework**: `next` (v14.2), `react` (v18.3), `react-dom`, `typescript`
- **3D Rendering & Rigging**: `three` (v0.166), `@react-three/fiber`, `@react-three/drei`, `@types/three`
- **Styling & UI**: `tailwindcss`, `postcss`, `autoprefixer`, `lucide-react`, `clsx`, `tailwind-merge`

---

### Step 4: Train or Verify the Diffusion Model *(Optional if checkpoint already exists)*

If `./checkpoints/diffusion/model.pt` is already present, you can skip this step. To train or retrain the diffusion model from scratch on CPU:

```bash
# Activate .venv first, then run:
python train_diffusion.py --epochs 200 --batch-size 32 --lr 3e-4 --smooth-weight 0.5
```

- **Training time**: ~20–25 minutes on a modern CPU.
- **Checkpoint output**: Saved automatically to `./checkpoints/diffusion/model.pt` whenever validation loss improves.

*(Optional)* To download the multi-lingual SignSuisse word-level lexicon (DSGS / LSF-CH / LIS-CH):
```bash
pip install "spoken-to-signed[lexicon]"
download_lexicon --name signsuisse --directory ./lexicon
python train_diffusion.py --lexicon ./lexicon --epochs 400
```

---

## 3. Running the Application

You need **two terminals** running simultaneously — one for the **FastAPI Backend (port 8000)** and one for the **Next.js Frontend (port 3000)**.

### Terminal 1: Start the FastAPI Backend (Port 8000)

**Windows (PowerShell):**
```powershell
.\.venv\Scripts\Activate.ps1
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

**macOS / Linux:**
```bash
source .venv/bin/activate
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Terminal 2: Start the Next.js Frontend (Port 3000)

```bash
cd frontend
npm run dev
```

---

### Accessing the Application

Once both servers are running, open your browser to:

- **3D Signing Studio (Main App)**: [http://localhost:3000/studio](http://localhost:3000/studio)
- **Home / Overview**: [http://localhost:3000](http://localhost:3000)
- **Quantitative & Human Evaluation Suite**: [http://localhost:3000/evaluation](http://localhost:3000/evaluation)
- **Architecture & How It Works**: [http://localhost:3000/how-it-works](http://localhost:3000/how-it-works)
- **Backend OpenAPI / Swagger Docs**: [http://localhost:8000/docs](http://localhost:8000/docs)

---

## 4. Using the 3D Signing Studio (`/studio`)

1. **Select an Avatar**:
   - **Human Interpreter (Michelle)**: Full-body Mixamo humanoid interpreter.
   - **Ready Player Me (Alex)**: High-detail avatar with facial morph targets (`mouthOpen`, `mouthSmile`).
   - *The camera automatically frames the head, torso, and signing workspace for whichever avatar is selected.*
2. **Choose the Motion Synthesis Engine**:
   - **Neural Diffusion (Bilateral: Both Hands Active)**: Uses the trained Transformer diffusion model (`66 points`) to synthesize coordinated two-handed signing and torso weight shift.
   - **S2S Capture (Real Human Mocap: 1-Hand Dominant Fingerspelling)**: Uses real human MediaPipe Holistic recordings (`178 points`). In ASL linguistics, fingerspelling A–Z is performed exclusively with the dominant right hand while the left hand rests naturally at the side.
3. **Toggle Biomechanical Landmarks**:
   - Check **"Biomechanical landmarks"** in the bottom telemetry bar of the 3D stage to overlay real-time 3D joint spheres and bone segments (Emerald = Left Hand, Blue = Right Hand, Amber = Face, Purple = Upper Body) directly over the avatar.
4. **Synthesize from Text or Speech**:
   - **Text**: Enter any English sentence (e.g., `"Where is the hospital?"`) and click **Generate & Sign (Live)**.
   - **Speech**: Press and hold **Hold to talk**, speak clearly into your microphone, and release to automatically transcribe and sign.

---

## 5. Project Structure

```text
sign_avatar/
├── main.py                              # FastAPI application entrypoint
├── train_diffusion.py                   # CPU training script for the Transformer DDPM
├── requirements.txt                     # Python backend dependencies
├── checkpoints/
│   └── diffusion/model.pt               # Trained diffusion model weights & vocabulary
├── app/
│   ├── config.py                        # Central settings (MOTION_BACKEND, FPS, smoothing)
│   ├── schemas.py                       # Pydantic request/response schemas
│   ├── api/
│   │   ├── routes.py                    # REST endpoints (/api/generate/text, /speech, /config)
│   │   ├── websocket.py                 # Real-time streaming WebSocket (/ws/generate)
│   │   └── evaluation_routes.py         # Quantitative metrics & study endpoints
│   └── services/
│       ├── pipeline.py                  # End-to-end orchestration & automatic fallback
│       ├── diffusion/
│       │   ├── data.py                  # 66-point pose normalization & dataset builder
│       │   └── model.py                 # MotionDenoiser Transformer + GaussianDiffusion (DDIM)
│       ├── diffusion_adapter.py         # Streaming & batch inference with Savitzky-Golay filter
│       ├── s2s_adapter.py               # 178-point MediaPipe Holistic capture backend
│       ├── motion_generator.py          # Procedural keyframe fallback backend
│       ├── text_to_gloss.py             # English-to-Gloss linguistic rules & non-manual markers
│       ├── speech_to_text.py            # Audio-to-Text service (16kHz PCM WAV + Google STT)
│       └── evaluation/
│           ├── metrics.py               # APE, DTW, Jerk Ratio, and Diversity computations
│           └── study.py                 # Human comprehension study storage & aggregation
└── frontend/                            # Next.js 14 App Router Frontend
    ├── package.json                     # Node.js dependencies
    ├── public/
    │   └── models/
    │       ├── michelle.glb             # Human Interpreter 3D rigged model
    │       └── avatar.glb               # Ready Player Me (Alex) 3D rigged model
    └── src/
        ├── app/
        │   ├── page.tsx                 # Landing page
        │   ├── studio/page.tsx          # Interactive 3D Signing Studio
        │   ├── evaluation/page.tsx      # Quantitative & human study dashboard
        │   ├── how-it-works/page.tsx    # Pipeline architecture documentation
        │   └── about/page.tsx           # Research overview & limitations
        ├── components/
        │   └── avatar/
        │       ├── AvatarStage.tsx      # Three.js Canvas, 3-point lighting, auto-framing camera
        │       ├── HumanAvatar.tsx      # GLTF skeleton cloning & animation loop
        │       └── BiomechanicalOverlay.tsx # 3D kinematic joint & bone overlay
        └── lib/
            ├── gltfRetargeter.ts        # Analytical Two-Bone IK & 21-joint hand retargeter
            ├── retargeter.ts            # One-Euro temporal filter bank
            └── websocket.ts             # Reconnecting WebSocket client
```

---

## 6. Troubleshooting

- **"Speech was not intelligible" / "No voice detected"**:
  - Make sure you **hold down** the **"Hold to talk"** button for at least half a second while speaking and release only after finishing your phrase.
  - Check that your browser has microphone permissions enabled for `localhost:3000`.
- **Why is only one hand moving in S2S mode?**:
  - In `s2s` fingerspelling mode, words are spelled letter-by-letter (A–Z). In American Sign Language, fingerspelling is a single-handed system performed by the dominant (right) hand. Switch the **Motion synthesis engine** dropdown to **Neural Diffusion (Bilateral: Both Hands Active)** for simultaneous two-handed signing.
- **WebSocket shows "Connecting to pipeline…" or Red Status**:
  - Ensure the FastAPI backend is running on port `8000` (`uvicorn main:app --reload --port 8000`).

---

## Licensing

- `spoken-to-signed-translation` is MIT licensed; SignSuisse lexicon data carries its own upstream terms.
- Please consult Deaf-led review and obtain IRB approval before conducting formal user studies with Deaf participants.
