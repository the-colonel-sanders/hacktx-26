
import sounddevice as sd
import numpy as np
from scipy.io.wavfile import write

# Recording settings
SAMPLE_RATE = 44100
DURATION = 5

print("Recording for 5 seconds...")
print("Stay quiet for 1 second, then clap once!")

# Record sound from the Mac microphone
recording = sd.rec(
    int(DURATION * SAMPLE_RATE),
    samplerate=SAMPLE_RATE,
    channels=1,
    dtype="float32"
)

# Wait until recording finishes
sd.wait()

print("Recording complete!")

# Save recording as a WAV file
write("./../audio/clap_test.wav", SAMPLE_RATE, recording)

# Convert recording into a 1D array
audio = recording[:, 0]

# Calculate loudness in 10-millisecond windows
window_size = int(SAMPLE_RATE * 0.01)

num_windows = len(audio) // window_size
trimmed = audio[:num_windows * window_size]

windows = trimmed.reshape(num_windows, window_size)

rms = np.sqrt(np.mean(windows ** 2, axis=1))

# Measure background noise during first second
noise_level = np.median(rms[:100])

# Set a threshold above background noise
threshold = max(0.015, noise_level * 8)

# Find windows exceeding the threshold
# Ignore the first second (calibration period)
loud_windows = np.where(
    (rms > threshold) &
    (np.arange(len(rms)) >= 100)
)[0]

if len(loud_windows) > 0:
    first_window = loud_windows[0]

    # Convert window index to seconds
    arrival_time = (
        first_window * window_size / SAMPLE_RATE
    )

    print(f"Sound detected at: {arrival_time:.3f} seconds")
else:
    print("No loud sound detected.")

print("Saved recording to clap_test.wav")
