
import numpy as np
from scipy.io import wavfile
from localization import locate_sound

SPEED_OF_SOUND = 343.0

# Read your actual clap recording.
sample_rate, audio = wavfile.read("clap_test.wav")

if audio.ndim == 2:
    audio = audio.mean(axis=1)

# Simulated phone positions, in meters.
phones = np.array([
    [0, 0],
    [20, 0],
    [0, 20],
    [20, 20]
])

# The simulated source location.
actual_source = np.array([8, 11])

arrival_times = []

for phone in phones:
    # Calculate the simulated travel distance.
    distance = np.linalg.norm(phone - actual_source)

    # Calculate sound travel time.
    travel_time = distance / SPEED_OF_SOUND

    # Delay the clap recording by that amount.
    delay_samples = round(travel_time * sample_rate)

    delayed_audio = np.pad(
        audio,
        (delay_samples, 0)
    )

    # Find the clap peak in this simulated recording.
    peak_index = np.argmax(np.abs(delayed_audio))

    arrival_time = peak_index / sample_rate

    arrival_times.append(arrival_time)

print("Detected arrival times:", arrival_times)

# Send the measured times to your localization algorithm.
result = locate_sound(phones.tolist(), arrival_times)

print("Estimated sound location:", result)
