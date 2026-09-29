"""Research reconstruction of finite-valued corner features/classifier, not a vectorizer."""
import math


def corner_features(points):
    """Seven ordered positions centered at points[3]; geometric reconstruction."""
    if len(points) != 7:
        raise ValueError('Expected seven points')
    directions, lengths = [], []
    for a, b in zip(points, points[1:]):
        dx, dy = b[0]-a[0], b[1]-a[1]
        length = math.sqrt(dx*dx + dy*dy)
        lengths.append(length)
        directions.append((dx/length, dy/length) if length > 0 else (dx, dy))
    a = [2-2*(u[0]*v[0]+u[1]*v[1]) for u, v in zip(directions, directions[1:])]
    # Orient side features by the smaller immediate-neighbor bend; ties use left.
    left, inner_low, center, inner_high, right = (
        [a[4], a[3], a[2], a[1], a[0]] if a[1] > a[3] else a)
    neighbors = [a[0], a[1], a[3], a[4]]
    side_three = [left, inner_low, right]

    def deviation(values):
        variance = sum(x*x for x in values)/len(values)-(sum(values)/len(values))**2
        # Reference convenience; actual SSE sqrt can produce NaN for negative roundoff.
        return math.sqrt(variance) if variance >= 0 else float('nan')

    return [sum(neighbors), a[1]+a[3], sum(side_three), left+inner_low,
            left, inner_low, center, inner_high, right, *lengths,
            float(a[2] == max(a)), min(neighbors), sorted(neighbors)[1],
            deviation(neighbors), sorted(side_three)[1], deviation(side_three)]


def probably_punctured(f):
    """Finite-input pseudocode recovered from 0x1000f1b70. int argument unused."""
    if len(f) != 21 or not all(math.isfinite(f[i]) for i in (0, 2, 6, 8, 15, 16)):
        raise ValueError('Expected 21 features with finite classifier inputs')
    c = f[6]
    if c < 0.611194:
        if c < 0.282594 or f[0] >= 0.322933:
            return False
        return c >= 0.483023 or f[0] < 0.0286571 or f[2] < 0.00209524
    if f[15] < 0.5:
        return c >= 1.72002
    if f[16] >= 0.097537:
        return False
    return c >= 1.42496 or f[2] < 0.122841 or f[0] < 0.445642 or f[8] < 0.0046405


def punctured_indices(contour):
    """Closed-contour reference; short contours bypass this corner pass."""
    n = len(contour)
    if n < 7:
        return []
    return [i for i in range(n)
            if probably_punctured(corner_features([contour[(i+j) % n] for j in range(-3, 4)]))]
