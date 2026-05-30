# Susura

<img src="assets/icons/icon-rounded-readme.png" alt="Susura icon" width="128" />

<a href="https://apotenza92.github.io/susura/">
  <img src="https://img.shields.io/badge/Download-Susura-0f766e?style=for-the-badge" alt="Download Susura" height="40">
</a>
<br><br>

Susura is a simple, private way to use AI live during a phone call. It prioritises fast local transcription models where practical, and for now uses your existing ChatGPT subscription for the AI model.

## Working Name

Susura comes from the Romance-language root for whispering or murmuring. It is close to Italian `sussurra`, but easier to spell.

## Audio Privacy Boundary

Susura hot-prepares selected audio sources at app startup to make Start listening feel immediate. That means microphone or system-audio streams may be opened while the app is idle, depending on the selected sources and macOS permissions. The Rust backend drops all frames while idle and must not emit transcript chunks or send provider requests until the user clicks Start listening. The project is open source so this boundary remains inspectable.
