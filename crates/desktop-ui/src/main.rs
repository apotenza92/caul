use dioxus::prelude::*;
use std::path::PathBuf;
use susura_desktop_ui::NativeUiModel;
use susura_macos_capture::RunningCapture;
use susura_session_core::SessionState;

fn main() {
    dioxus_native::launch(app);
}

fn app() -> Element {
    let mut model = use_signal_sync(NativeUiModel::default);
    let mut capture = use_signal(|| None::<RunningCapture>);

    let current_model = model.read().clone();
    let has_audio_source = current_model.settings.has_selected_source();
    let can_start = current_model.can_start_system_audio();
    let can_stop = matches!(
        current_model.session_state,
        SessionState::Starting | SessionState::Listening | SessionState::Failed
    );
    let listen_to_microphone = current_model.settings.listen_to_microphone;
    let listen_to_system_audio = current_model.settings.listen_to_system_audio;
    let visible_transcript = current_model.visible_transcript();
    let transcript_output = if visible_transcript.is_empty() {
        String::new()
    } else {
        visible_transcript.to_string()
    };

    rsx! {
        main {
            fieldset {
                legend { "Audio sources" }

                label {
                    input {
                        r#type: "checkbox",
                        checked: listen_to_system_audio,
                        disabled: can_stop,
                        onclick: move |_| {
                            let next = !model.read().settings.listen_to_system_audio;
                            model.write().settings.listen_to_system_audio = next;
                        }
                    }
                    "System audio"
                }
                br {}

                label {
                    input {
                        r#type: "checkbox",
                        checked: listen_to_microphone,
                        disabled: can_stop,
                        onclick: move |_| {
                            let next = !model.read().settings.listen_to_microphone;
                            model.write().settings.listen_to_microphone = next;
                        }
                    }
                    "Microphone"
                }
            }

            if can_stop {
                button {
                    disabled: false,
                    r#type: "button",
                    onclick: move |_| {
                        if let Some(mut running_capture) = capture.write().take() {
                            running_capture.stop();
                        }

                        model.write().reset_session();
                    },
                    "Stop"
                }
            } else {
                button {
                    disabled: !has_audio_source || !can_start,
                    r#type: "button",
                    onclick: move |_| {
                        model.write().start_system_audio();

                        match RunningCapture::start_system_audio(repository_root(), true) {
                            Ok((running_capture, receiver)) => {
                                let mut model_for_events = model;
                                std::thread::spawn(move || {
                                    for update in receiver {
                                        model_for_events.write().apply_capture_update(update);
                                    }
                                });

                                capture.set(Some(running_capture));
                            }
                            Err(error) => {
                                model.write().fail_session(error.to_string());
                            }
                        }
                    },
                    "Start"
                }
            }

            br {}

            textarea {
                readonly: true,
                rows: 12,
                cols: 60,
                value: "{transcript_output}"
            }
        }
    }
}

fn repository_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."))
}
