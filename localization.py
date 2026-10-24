
import numpy as np
from scipy.optimize import least_squares

SPEED_OF_SOUND = 343.0  # meters per second


def locate_sound(phone_positions, arrival_times):
    """
    Estimate the 2D location of a sound source.

    phone_positions: list of [x, y] coordinates in meters
    arrival_times: synchronized arrival times in seconds

    Returns: estimated X, Y, and fit error
    """

    phones = np.array(phone_positions, dtype=float)
    times = np.array(arrival_times, dtype=float)

    if phones.ndim != 2 or phones.shape[1] != 2:
        raise ValueError("Positions must be [x, y] pairs")

    if len(phones) < 4:
        raise ValueError("At least 4 phones required")

    if times.shape != (len(phones),):
        raise ValueError("One arrival time per phone required")

    if not np.isfinite(phones).all() or not np.isfinite(times).all():
        raise ValueError("Inputs must be finite numbers")

    if np.linalg.matrix_rank(phones[1:] - phones[0]) < 2:
        raise ValueError("Phone positions cannot be collinear")

    # Step 1: Calculate measured distance differences.
    time_differences = times[1:] - times[0]
    observed = SPEED_OF_SOUND * time_differences

    # Step 2: Define the equations we want to solve.
    def residuals(source):
        # Distance from candidate source to every phone.
        distances = np.linalg.norm(phones - source, axis=1)

        # Expected distance differences.
        predicted = distances[1:] - distances[0]

        # Difference between predicted and observed values.
        return predicted - observed

    # Step 3: Try several starting positions.
    guesses = [phones.mean(axis=0), *phones]

    solutions = [
        least_squares(residuals, guess)
        for guess in guesses
    ]

    # Step 4: Select the solution with the smallest error.
    best = min(
        solutions,
        key=lambda result: np.dot(result.fun, result.fun)
    )

    rms_error = np.sqrt(np.mean(best.fun ** 2))

    return {
        "x_m": round(float(best.x[0]), 3),
        "y_m": round(float(best.x[1]), 3),
        "fit_error_m": round(float(rms_error), 3)
    }


# -----------------------------
# TEST WITH SIMULATED DATA
# -----------------------------

phones = [
    [0, 0],
    [20, 0],
    [0, 20],
    [20, 20]
]

# We know the source is at (8, 11).
actual_source = np.array([8, 11])

# Simulate when the sound reaches each phone.
distances = np.linalg.norm(
    np.array(phones) - actual_source,
    axis=1
)

arrival_times = 10.0 + distances / SPEED_OF_SOUND

result = locate_sound(phones, arrival_times)

print(result)
