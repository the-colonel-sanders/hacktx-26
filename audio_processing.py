
import numpy as np
from scipy.io import wavfile
from localization import locate_sound


def get_arrival_time(filename, recording_start_s):
    """
    Estimate when a short, sharp sound occurred.

    recording_start_s must be the recording's
    start time on a synchronized common clock.
    """

    sample_rate, audio = wavfile.read(filename)

    # Convert the samples to floating-point numbers.
    audio = np.asarray(audio, dtype=np.float64)

    # Convert stereo audio to mono.
    if audio.ndim == 2:
        audio = audio.mean(axis=1)

    if audio.size == 0:
        raise ValueError("Empty audio file")

    # Find the largest sound amplitude.
    peak_index = np.argmax(np.abs(audio))

    # Convert sample index to elapsed seconds.
    elapsed_time = peak_index / sample_rate

    # Convert to the shared timeline.
    return recording_start_s + elapsed_time


# Known phone coordinates in meters
phone_positions = [
    [0, 0],
    [20, 0],
    [0, 20],
    [20, 20]
]

# Files supplied by each phone
files = [
    "phone_A.wav",
    "phone_B.wav",
    "phone_C.wav",
    "phone_D.wav"
]

# EXAMPLE ONLY:
# Zero assumes all WAV sample zero positions refer
# to the exact same synchronized starting instant.
recording_starts = [0.0, 0.0, 0.0, 0.0]

arrival_times = []

for filename, start_time in zip(files, recording_starts):
    arrival = get_arrival_time(filename, start_time)
    arrival_times.append(arrival)

print("Arrival times:", arrival_times)

# Pass the measurements to your existing solver.
result = locate_sound(phone_positions, arrival_times)

print("Estimated location:", result)
