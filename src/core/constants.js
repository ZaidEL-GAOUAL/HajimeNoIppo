// World units are meters. The ring canvas surface is at y = 0, centered on the origin.

export const RING = {
    ropeHalf: 3.05, // inside of the ropes
    postHalf: 3.2,
    platformHalf: 3.78,
    platformHeight: 1.2,
    ropeHeights: [0.42, 0.74, 1.06, 1.38],
    playHalf: 2.72, // how far a fighter's root may go from the center on x/z
};

export const FIXED_DT = 1 / 60;

export const CORNERS = {
    red: { x: -RING.postHalf, z: -RING.postHalf },
    blue: { x: RING.postHalf, z: RING.postHalf },
};
