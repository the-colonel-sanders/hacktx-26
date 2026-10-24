import numpy as np
import scipy.io.wavfile as wav
import pyroomacoustics as pra
import serpapi

audio_files = ["./../data/clap_test.wav"]  # List of audio files to process

def get_phone_coordinates(query: str, api_key: str, lat: float, lng: float):
    client = serpapi.Client(api_key=api_key)
    results = client.search({
    "engine": "google_maps",
    "q": query,
    "ll": "@" + str(lat) + "," + str(lng) + ",14z"
    })
    local_results = results["local_results"]
    
    


def get_time_delay(audio_file):
    # 1. Load multichannel recording from the phone (e.g., 2 or 3 channels)
    # audio_data shape: (n_samples, n_channels)
    fs, audio_data = wav.read(audio_file)
    print(wav.read(audio_file))
    if audio_data.shape[0] < audio_data.shape[1]:
        audio_data = audio_data.T  # Transpose to shape (n_channels, n_samples)

    # 2. Define Microphone Array Geometry (in meters)
    # Example: 3-mic smartphone array coordinates relative to primary mic at (0,0,0)
    R = np.array([
        [0.00,  0.00, 0.0],  # Mic 1 (Bottom mic)
        [0.07,  0.00, 0.0],  # Mic 2 (Top mic, 7cm away on X axis)
        [0.035, 0.12, 0.0]   # Mic 3 (Back camera mic)
    ]).T                     # Shape: (3, n_mics)

    # 3. Short-Time Fourier Transform (STFT) Settings
    nfft = 2048
    hop = 512
    X = pra.transform.stft.analysis(audio_data, nfft=nfft, hop=hop)
    print(X.shape)
    # X shape: (n_frames, n_freq_bins, n_channels)
    if X.ndim == 3:
        X = np.transpose(X, (2, 1, 0))
    else:
        raise ValueError(f"Expected 3D STFT array, but got shape {X.shape}. Check your audio_data input dimensions.")

    # 4. Initialize DOA Algorithm for Direction & Time Differences
    # Algorithms: 'SRP' (Steered Response Power), 'MUSIC', 'CSSM', 'TOPS'
    doa = pra.doa.SRP(L=R, fs=fs, nfft=nfft, c=343.0, num_src=1)
    doa.locate_sources(X)

    # Extracted Azimuth/Elevation Angles (in radians)
    azimuth_rad = doa.azimuth_recon[0]
    print(f"Estimated Direction (Azimuth): {np.degrees(azimuth_rad):.2f} degrees")

    # 5. Calculate Relative Time Difference of Arrival (TDOA)
    # Relative delays across microphones based on the reconstructed direction
    mic_center = np.mean(R, axis=1, keepdims=True)
    directions = pra.doa.spher2cart(azimuth_rad, 0, 1) # Unit vector in direction of sound
    delays_seconds = np.dot(R - mic_center, directions) / 343.0

    for i, delay in enumerate(delays_seconds.ravel()):
        print(f"Mic {i} Time Delay relative to center: {delay * 1000:.3f} ms")
        
        
def __main__(args):
    get_time_delay(audio_file=audio_files[0])
    
    
if __name__ == "__main__":
    __main__(None)