/** Official vanilla cubes: Java LayerDefinitions (EntityModelJson 1.19 dump)
 * plus Mojang cow.v2 / pig.v3 / mooshroom.v2 geos for the 1.21.5 remodel.
 */
export type ExtraFaceUv = { uv: [number, number]; uvSize: [number, number] }
export type ExtraBoneXform = { pivot: [number, number, number]; rotation: [number, number, number] }
export type ExtraCube = {
  origin: [number, number, number]
  size: [number, number, number]
  uv:
    | [number, number]
    | Partial<Record<'north' | 'south' | 'east' | 'west' | 'up' | 'down', ExtraFaceUv>>
  inflate?: number
  mirror?: boolean
  pivot?: [number, number, number]
  rotation?: [number, number, number]
  parents?: ExtraBoneXform[]
  name?: string
  poseParent?: string
}
export type ExtraEntityDump = {
  id: string
  textureSize: [number, number]
  cubes: ExtraCube[]
}

export const VANILLA_EXTRA_ENTITIES: Record<string, ExtraEntityDump> = {
  "creeper": {
    "id": "creeper",
    "textureSize": [
      64,
      32
    ],
    "cubes": [
      {
        "origin": [
          -4,
          18,
          -4
        ],
        "size": [
          8,
          8,
          8
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "pivot": [
          0,
          18,
          0
        ]
      },
      {
        "origin": [
          -4,
          0,
          -6
        ],
        "size": [
          4,
          6,
          4
        ],
        "uv": [
          0,
          16
        ],
        "name": "right_front_leg",
        "pivot": [
          -2,
          6,
          -4
        ]
      },
      {
        "origin": [
          -4,
          0,
          2
        ],
        "size": [
          4,
          6,
          4
        ],
        "uv": [
          0,
          16
        ],
        "name": "right_hind_leg",
        "pivot": [
          -2,
          6,
          4
        ]
      },
      {
        "origin": [
          0,
          0,
          2
        ],
        "size": [
          4,
          6,
          4
        ],
        "uv": [
          0,
          16
        ],
        "name": "left_hind_leg",
        "pivot": [
          2,
          6,
          4
        ]
      },
      {
        "origin": [
          -4,
          6,
          -2
        ],
        "size": [
          8,
          12,
          4
        ],
        "uv": [
          16,
          16
        ],
        "name": "body",
        "pivot": [
          0,
          18,
          0
        ]
      },
      {
        "origin": [
          0,
          0,
          -6
        ],
        "size": [
          4,
          6,
          4
        ],
        "uv": [
          0,
          16
        ],
        "name": "left_front_leg",
        "pivot": [
          2,
          6,
          -4
        ]
      }
    ]
  },
  "enderman": {
    "id": "enderman",
    "textureSize": [
      64,
      32
    ],
    "cubes": [
      {
        "origin": [
          -4,
          37,
          -4
        ],
        "size": [
          8,
          8,
          8
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "pivot": [
          0,
          37,
          0
        ]
      },
      {
        "origin": [
          -6,
          8,
          -1
        ],
        "size": [
          2,
          30,
          2
        ],
        "uv": [
          56,
          0
        ],
        "name": "right_arm",
        "pivot": [
          -5,
          36,
          0
        ]
      },
      {
        "origin": [
          1,
          -1,
          -1
        ],
        "size": [
          2,
          30,
          2
        ],
        "uv": [
          56,
          0
        ],
        "name": "left_leg",
        "mirror": true,
        "pivot": [
          2,
          29,
          0
        ]
      },
      {
        "origin": [
          4,
          8,
          -1
        ],
        "size": [
          2,
          30,
          2
        ],
        "uv": [
          56,
          0
        ],
        "name": "left_arm",
        "mirror": true,
        "pivot": [
          5,
          36,
          0
        ]
      },
      {
        "origin": [
          -3,
          -1,
          -1
        ],
        "size": [
          2,
          30,
          2
        ],
        "uv": [
          56,
          0
        ],
        "name": "right_leg",
        "pivot": [
          -2,
          29,
          0
        ]
      },
      {
        "origin": [
          -4,
          37,
          -4
        ],
        "size": [
          8,
          8,
          8
        ],
        "uv": [
          0,
          16
        ],
        "name": "hat",
        "inflate": -0.5,
        "pivot": [
          0,
          37,
          0
        ]
      },
      {
        "origin": [
          -4,
          26,
          -2
        ],
        "size": [
          8,
          12,
          4
        ],
        "uv": [
          32,
          16
        ],
        "name": "body",
        "pivot": [
          0,
          38,
          0
        ]
      }
    ]
  },
  "villager": {
    "id": "villager",
    "textureSize": [
      64,
      64
    ],
    "cubes": [
      {
        "origin": [
          -4,
          24,
          -4
        ],
        "size": [
          8,
          10,
          8
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          -1,
          23,
          -6
        ],
        "size": [
          2,
          4,
          2
        ],
        "uv": [
          24,
          0
        ],
        "name": "nose",
        "poseParent": "head",
        "pivot": [
          0,
          26,
          0
        ]
      },
      {
        "origin": [
          -4,
          24,
          -4
        ],
        "size": [
          8,
          10,
          8
        ],
        "uv": [
          32,
          0
        ],
        "name": "hat",
        "poseParent": "head",
        "inflate": 0.51,
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          -8,
          16,
          -6
        ],
        "size": [
          16,
          16,
          1
        ],
        "uv": [
          30,
          47
        ],
        "name": "hat_rim",
        "poseParent": "hat",
        "pivot": [
          0,
          24,
          0
        ],
        "rotation": [
          90,
          0,
          0
        ]
      },
      {
        "origin": [
          0,
          0,
          -2
        ],
        "size": [
          4,
          12,
          4
        ],
        "uv": [
          0,
          22
        ],
        "name": "left_leg",
        "mirror": true,
        "pivot": [
          2,
          12,
          0
        ]
      },
      {
        "origin": [
          -4,
          0,
          -2
        ],
        "size": [
          4,
          12,
          4
        ],
        "uv": [
          0,
          22
        ],
        "name": "right_leg",
        "pivot": [
          -2,
          12,
          0
        ]
      },
      {
        "origin": [
          -8,
          15,
          -3
        ],
        "size": [
          4,
          8,
          4
        ],
        "uv": [
          44,
          22
        ],
        "name": "arms",
        "pivot": [
          0,
          21,
          -1
        ],
        "rotation": [
          42.972,
          0,
          0
        ]
      },
      {
        "origin": [
          4,
          15,
          -3
        ],
        "size": [
          4,
          8,
          4
        ],
        "uv": [
          44,
          22
        ],
        "name": "arms",
        "mirror": true,
        "pivot": [
          0,
          21,
          -1
        ],
        "rotation": [
          42.972,
          0,
          0
        ]
      },
      {
        "origin": [
          -4,
          15,
          -3
        ],
        "size": [
          8,
          4,
          4
        ],
        "uv": [
          40,
          38
        ],
        "name": "arms",
        "pivot": [
          0,
          21,
          -1
        ],
        "rotation": [
          42.972,
          0,
          0
        ]
      },
      {
        "origin": [
          -4,
          12,
          -3
        ],
        "size": [
          8,
          12,
          6
        ],
        "uv": [
          16,
          20
        ],
        "name": "body",
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          -4,
          4,
          -3
        ],
        "size": [
          8,
          20,
          6
        ],
        "uv": [
          0,
          38
        ],
        "name": "jacket",
        "poseParent": "body",
        "inflate": 0.5,
        "pivot": [
          0,
          24,
          0
        ]
      }
    ]
  },
  "wandering_trader": {
    "id": "wandering_trader",
    "textureSize": [
      64,
      64
    ],
    "cubes": [
      {
        "origin": [
          -4,
          24,
          -4
        ],
        "size": [
          8,
          10,
          8
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          -1,
          23,
          -6
        ],
        "size": [
          2,
          4,
          2
        ],
        "uv": [
          24,
          0
        ],
        "name": "nose",
        "poseParent": "head",
        "pivot": [
          0,
          26,
          0
        ]
      },
      {
        "origin": [
          -4,
          24,
          -4
        ],
        "size": [
          8,
          10,
          8
        ],
        "uv": [
          32,
          0
        ],
        "name": "hat",
        "poseParent": "head",
        "inflate": 0.51,
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          -8,
          16,
          -6
        ],
        "size": [
          16,
          16,
          1
        ],
        "uv": [
          30,
          47
        ],
        "name": "hat_rim",
        "poseParent": "hat",
        "pivot": [
          0,
          24,
          0
        ],
        "rotation": [
          90,
          0,
          0
        ]
      },
      {
        "origin": [
          0,
          0,
          -2
        ],
        "size": [
          4,
          12,
          4
        ],
        "uv": [
          0,
          22
        ],
        "name": "left_leg",
        "mirror": true,
        "pivot": [
          2,
          12,
          0
        ]
      },
      {
        "origin": [
          -4,
          0,
          -2
        ],
        "size": [
          4,
          12,
          4
        ],
        "uv": [
          0,
          22
        ],
        "name": "right_leg",
        "pivot": [
          -2,
          12,
          0
        ]
      },
      {
        "origin": [
          -8,
          15,
          -3
        ],
        "size": [
          4,
          8,
          4
        ],
        "uv": [
          44,
          22
        ],
        "name": "arms",
        "pivot": [
          0,
          21,
          -1
        ],
        "rotation": [
          42.972,
          0,
          0
        ]
      },
      {
        "origin": [
          4,
          15,
          -3
        ],
        "size": [
          4,
          8,
          4
        ],
        "uv": [
          44,
          22
        ],
        "name": "arms",
        "mirror": true,
        "pivot": [
          0,
          21,
          -1
        ],
        "rotation": [
          42.972,
          0,
          0
        ]
      },
      {
        "origin": [
          -4,
          15,
          -3
        ],
        "size": [
          8,
          4,
          4
        ],
        "uv": [
          40,
          38
        ],
        "name": "arms",
        "pivot": [
          0,
          21,
          -1
        ],
        "rotation": [
          42.972,
          0,
          0
        ]
      },
      {
        "origin": [
          -4,
          12,
          -3
        ],
        "size": [
          8,
          12,
          6
        ],
        "uv": [
          16,
          20
        ],
        "name": "body",
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          -4,
          4,
          -3
        ],
        "size": [
          8,
          20,
          6
        ],
        "uv": [
          0,
          38
        ],
        "name": "jacket",
        "poseParent": "body",
        "inflate": 0.5,
        "pivot": [
          0,
          24,
          0
        ]
      }
    ]
  },
  "witch": {
    "id": "witch",
    "textureSize": [
      64,
      128
    ],
    "cubes": [
      {
        "origin": [
          -4,
          24,
          -4
        ],
        "size": [
          8,
          10,
          8
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          -1,
          23,
          -6
        ],
        "size": [
          2,
          4,
          2
        ],
        "uv": [
          24,
          0
        ],
        "name": "nose",
        "poseParent": "head",
        "pivot": [
          0,
          26,
          0
        ]
      },
      {
        "origin": [
          0,
          24,
          -6.75
        ],
        "size": [
          1,
          1,
          1
        ],
        "uv": [
          0,
          0
        ],
        "name": "mole",
        "poseParent": "nose",
        "inflate": -0.25,
        "pivot": [
          0,
          28,
          0
        ]
      },
      {
        "origin": [
          -5,
          32.031,
          -5
        ],
        "size": [
          10,
          2,
          10
        ],
        "uv": [
          0,
          64
        ],
        "name": "hat",
        "poseParent": "head",
        "pivot": [
          -5,
          34.031,
          -5
        ]
      },
      {
        "origin": [
          -13,
          26.031,
          -11
        ],
        "size": [
          16,
          16,
          1
        ],
        "uv": [
          30,
          47
        ],
        "name": "hat_rim",
        "poseParent": "hat",
        "pivot": [
          -5,
          34.031,
          -5
        ],
        "rotation": [
          90,
          0,
          0
        ]
      },
      {
        "origin": [
          -3.25,
          34.031,
          -3
        ],
        "size": [
          7,
          4,
          7
        ],
        "uv": [
          0,
          76
        ],
        "name": "hat2",
        "poseParent": "hat",
        "pivot": [
          -3.25,
          38.031,
          -3
        ],
        "rotation": [
          3,
          0,
          1.5
        ]
      },
      {
        "origin": [
          -1.5,
          38.031,
          -1
        ],
        "size": [
          4,
          4,
          4
        ],
        "uv": [
          0,
          87
        ],
        "name": "hat3",
        "poseParent": "hat2",
        "pivot": [
          -1.5,
          42.031,
          -1
        ],
        "rotation": [
          6,
          0,
          3
        ],
        "parents": [
          {
            "pivot": [
              -3.25,
              38.031,
              -3
            ],
            "rotation": [
              3,
              0,
              1.5
            ]
          }
        ]
      },
      {
        "origin": [
          0.25,
          42.031,
          1
        ],
        "size": [
          1,
          2,
          1
        ],
        "uv": [
          0,
          95
        ],
        "name": "hat4",
        "poseParent": "hat3",
        "inflate": 0.25,
        "pivot": [
          0.25,
          44.031,
          1
        ],
        "rotation": [
          12,
          0,
          6
        ],
        "parents": [
          {
            "pivot": [
              -3.25,
              38.031,
              -3
            ],
            "rotation": [
              3,
              0,
              1.5
            ]
          },
          {
            "pivot": [
              -1.5,
              42.031,
              -1
            ],
            "rotation": [
              6,
              0,
              3
            ]
          }
        ]
      },
      {
        "origin": [
          0,
          0,
          -2
        ],
        "size": [
          4,
          12,
          4
        ],
        "uv": [
          0,
          22
        ],
        "name": "left_leg",
        "mirror": true,
        "pivot": [
          2,
          12,
          0
        ]
      },
      {
        "origin": [
          -4,
          0,
          -2
        ],
        "size": [
          4,
          12,
          4
        ],
        "uv": [
          0,
          22
        ],
        "name": "right_leg",
        "pivot": [
          -2,
          12,
          0
        ]
      },
      {
        "origin": [
          -8,
          15,
          -3
        ],
        "size": [
          4,
          8,
          4
        ],
        "uv": [
          44,
          22
        ],
        "name": "arms",
        "pivot": [
          0,
          21,
          -1
        ],
        "rotation": [
          42.972,
          0,
          0
        ]
      },
      {
        "origin": [
          4,
          15,
          -3
        ],
        "size": [
          4,
          8,
          4
        ],
        "uv": [
          44,
          22
        ],
        "name": "arms",
        "mirror": true,
        "pivot": [
          0,
          21,
          -1
        ],
        "rotation": [
          42.972,
          0,
          0
        ]
      },
      {
        "origin": [
          -4,
          15,
          -3
        ],
        "size": [
          8,
          4,
          4
        ],
        "uv": [
          40,
          38
        ],
        "name": "arms",
        "pivot": [
          0,
          21,
          -1
        ],
        "rotation": [
          42.972,
          0,
          0
        ]
      },
      {
        "origin": [
          -4,
          12,
          -3
        ],
        "size": [
          8,
          12,
          6
        ],
        "uv": [
          16,
          20
        ],
        "name": "body",
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          -4,
          4,
          -3
        ],
        "size": [
          8,
          20,
          6
        ],
        "uv": [
          0,
          38
        ],
        "name": "jacket",
        "poseParent": "body",
        "inflate": 0.5,
        "pivot": [
          0,
          24,
          0
        ]
      }
    ]
  },
  "vindicator": {
    "id": "vindicator",
    "textureSize": [
      64,
      64
    ],
    "cubes": [
      {
        "origin": [
          -4,
          24,
          -4
        ],
        "size": [
          8,
          10,
          8
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          -1,
          23,
          -6
        ],
        "size": [
          2,
          4,
          2
        ],
        "uv": [
          24,
          0
        ],
        "name": "nose",
        "poseParent": "head",
        "pivot": [
          0,
          26,
          0
        ]
      },
      {
        "origin": [
          -4,
          22,
          -4
        ],
        "size": [
          8,
          12,
          8
        ],
        "uv": [
          32,
          0
        ],
        "name": "hat",
        "poseParent": "head",
        "inflate": 0.45,
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          0,
          0,
          -2
        ],
        "size": [
          4,
          12,
          4
        ],
        "uv": [
          0,
          22
        ],
        "name": "left_leg",
        "mirror": true,
        "pivot": [
          2,
          12,
          0
        ]
      },
      {
        "origin": [
          -8,
          12,
          -2
        ],
        "size": [
          4,
          12,
          4
        ],
        "uv": [
          40,
          46
        ],
        "name": "right_arm",
        "pivot": [
          -5,
          22,
          0
        ]
      },
      {
        "origin": [
          -4,
          0,
          -2
        ],
        "size": [
          4,
          12,
          4
        ],
        "uv": [
          0,
          22
        ],
        "name": "right_leg",
        "pivot": [
          -2,
          12,
          0
        ]
      },
      {
        "origin": [
          4,
          12,
          -2
        ],
        "size": [
          4,
          12,
          4
        ],
        "uv": [
          40,
          46
        ],
        "name": "left_arm",
        "mirror": true,
        "pivot": [
          5,
          22,
          0
        ]
      },
      {
        "origin": [
          -8,
          15,
          -3
        ],
        "size": [
          4,
          8,
          4
        ],
        "uv": [
          44,
          22
        ],
        "name": "arms",
        "pivot": [
          0,
          21,
          -1
        ],
        "rotation": [
          42.972,
          0,
          0
        ]
      },
      {
        "origin": [
          -4,
          15,
          -3
        ],
        "size": [
          8,
          4,
          4
        ],
        "uv": [
          40,
          38
        ],
        "name": "arms",
        "pivot": [
          0,
          21,
          -1
        ],
        "rotation": [
          42.972,
          0,
          0
        ]
      },
      {
        "origin": [
          4,
          15,
          -3
        ],
        "size": [
          4,
          8,
          4
        ],
        "uv": [
          44,
          22
        ],
        "name": "left_shoulder",
        "poseParent": "arms",
        "mirror": true,
        "pivot": [
          0,
          21,
          -1
        ],
        "parents": [
          {
            "pivot": [
              0,
              21,
              -1
            ],
            "rotation": [
              42.972,
              0,
              0
            ]
          }
        ]
      },
      {
        "origin": [
          -4,
          12,
          -3
        ],
        "size": [
          8,
          12,
          6
        ],
        "uv": [
          16,
          20
        ],
        "name": "body",
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          -4,
          4,
          -3
        ],
        "size": [
          8,
          20,
          6
        ],
        "uv": [
          0,
          38
        ],
        "name": "body",
        "inflate": 0.5,
        "pivot": [
          0,
          24,
          0
        ]
      }
    ]
  },
  "pillager": {
    "id": "pillager",
    "textureSize": [
      64,
      64
    ],
    "cubes": [
      {
        "origin": [
          -4,
          24,
          -4
        ],
        "size": [
          8,
          10,
          8
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          -1,
          23,
          -6
        ],
        "size": [
          2,
          4,
          2
        ],
        "uv": [
          24,
          0
        ],
        "name": "nose",
        "poseParent": "head",
        "pivot": [
          0,
          26,
          0
        ]
      },
      {
        "origin": [
          -4,
          22,
          -4
        ],
        "size": [
          8,
          12,
          8
        ],
        "uv": [
          32,
          0
        ],
        "name": "hat",
        "poseParent": "head",
        "inflate": 0.45,
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          0,
          0,
          -2
        ],
        "size": [
          4,
          12,
          4
        ],
        "uv": [
          0,
          22
        ],
        "name": "left_leg",
        "mirror": true,
        "pivot": [
          2,
          12,
          0
        ]
      },
      {
        "origin": [
          -8,
          12,
          -2
        ],
        "size": [
          4,
          12,
          4
        ],
        "uv": [
          40,
          46
        ],
        "name": "right_arm",
        "pivot": [
          -5,
          22,
          0
        ]
      },
      {
        "origin": [
          -4,
          0,
          -2
        ],
        "size": [
          4,
          12,
          4
        ],
        "uv": [
          0,
          22
        ],
        "name": "right_leg",
        "pivot": [
          -2,
          12,
          0
        ]
      },
      {
        "origin": [
          4,
          12,
          -2
        ],
        "size": [
          4,
          12,
          4
        ],
        "uv": [
          40,
          46
        ],
        "name": "left_arm",
        "mirror": true,
        "pivot": [
          5,
          22,
          0
        ]
      },
      {
        "origin": [
          -8,
          15,
          -3
        ],
        "size": [
          4,
          8,
          4
        ],
        "uv": [
          44,
          22
        ],
        "name": "arms",
        "pivot": [
          0,
          21,
          -1
        ],
        "rotation": [
          42.972,
          0,
          0
        ]
      },
      {
        "origin": [
          -4,
          15,
          -3
        ],
        "size": [
          8,
          4,
          4
        ],
        "uv": [
          40,
          38
        ],
        "name": "arms",
        "pivot": [
          0,
          21,
          -1
        ],
        "rotation": [
          42.972,
          0,
          0
        ]
      },
      {
        "origin": [
          4,
          15,
          -3
        ],
        "size": [
          4,
          8,
          4
        ],
        "uv": [
          44,
          22
        ],
        "name": "left_shoulder",
        "poseParent": "arms",
        "mirror": true,
        "pivot": [
          0,
          21,
          -1
        ],
        "parents": [
          {
            "pivot": [
              0,
              21,
              -1
            ],
            "rotation": [
              42.972,
              0,
              0
            ]
          }
        ]
      },
      {
        "origin": [
          -4,
          12,
          -3
        ],
        "size": [
          8,
          12,
          6
        ],
        "uv": [
          16,
          20
        ],
        "name": "body",
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          -4,
          4,
          -3
        ],
        "size": [
          8,
          20,
          6
        ],
        "uv": [
          0,
          38
        ],
        "name": "body",
        "inflate": 0.5,
        "pivot": [
          0,
          24,
          0
        ]
      }
    ]
  },
  "evoker": {
    "id": "evoker",
    "textureSize": [
      64,
      64
    ],
    "cubes": [
      {
        "origin": [
          -4,
          24,
          -4
        ],
        "size": [
          8,
          10,
          8
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          -1,
          23,
          -6
        ],
        "size": [
          2,
          4,
          2
        ],
        "uv": [
          24,
          0
        ],
        "name": "nose",
        "poseParent": "head",
        "pivot": [
          0,
          26,
          0
        ]
      },
      {
        "origin": [
          -4,
          22,
          -4
        ],
        "size": [
          8,
          12,
          8
        ],
        "uv": [
          32,
          0
        ],
        "name": "hat",
        "poseParent": "head",
        "inflate": 0.45,
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          0,
          0,
          -2
        ],
        "size": [
          4,
          12,
          4
        ],
        "uv": [
          0,
          22
        ],
        "name": "left_leg",
        "mirror": true,
        "pivot": [
          2,
          12,
          0
        ]
      },
      {
        "origin": [
          -8,
          12,
          -2
        ],
        "size": [
          4,
          12,
          4
        ],
        "uv": [
          40,
          46
        ],
        "name": "right_arm",
        "pivot": [
          -5,
          22,
          0
        ]
      },
      {
        "origin": [
          -4,
          0,
          -2
        ],
        "size": [
          4,
          12,
          4
        ],
        "uv": [
          0,
          22
        ],
        "name": "right_leg",
        "pivot": [
          -2,
          12,
          0
        ]
      },
      {
        "origin": [
          4,
          12,
          -2
        ],
        "size": [
          4,
          12,
          4
        ],
        "uv": [
          40,
          46
        ],
        "name": "left_arm",
        "mirror": true,
        "pivot": [
          5,
          22,
          0
        ]
      },
      {
        "origin": [
          -8,
          15,
          -3
        ],
        "size": [
          4,
          8,
          4
        ],
        "uv": [
          44,
          22
        ],
        "name": "arms",
        "pivot": [
          0,
          21,
          -1
        ],
        "rotation": [
          42.972,
          0,
          0
        ]
      },
      {
        "origin": [
          -4,
          15,
          -3
        ],
        "size": [
          8,
          4,
          4
        ],
        "uv": [
          40,
          38
        ],
        "name": "arms",
        "pivot": [
          0,
          21,
          -1
        ],
        "rotation": [
          42.972,
          0,
          0
        ]
      },
      {
        "origin": [
          4,
          15,
          -3
        ],
        "size": [
          4,
          8,
          4
        ],
        "uv": [
          44,
          22
        ],
        "name": "left_shoulder",
        "poseParent": "arms",
        "mirror": true,
        "pivot": [
          0,
          21,
          -1
        ],
        "parents": [
          {
            "pivot": [
              0,
              21,
              -1
            ],
            "rotation": [
              42.972,
              0,
              0
            ]
          }
        ]
      },
      {
        "origin": [
          -4,
          12,
          -3
        ],
        "size": [
          8,
          12,
          6
        ],
        "uv": [
          16,
          20
        ],
        "name": "body",
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          -4,
          4,
          -3
        ],
        "size": [
          8,
          20,
          6
        ],
        "uv": [
          0,
          38
        ],
        "name": "body",
        "inflate": 0.5,
        "pivot": [
          0,
          24,
          0
        ]
      }
    ]
  },
  "iron_golem": {
    "id": "iron_golem",
    "textureSize": [
      128,
      128
    ],
    "cubes": [
      {
        "origin": [
          -4,
          33,
          -7.5
        ],
        "size": [
          8,
          10,
          8
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "pivot": [
          0,
          31,
          -2
        ]
      },
      {
        "origin": [
          -1,
          32,
          -9.5
        ],
        "size": [
          2,
          4,
          2
        ],
        "uv": [
          24,
          0
        ],
        "name": "head",
        "pivot": [
          0,
          31,
          -2
        ]
      },
      {
        "origin": [
          -13,
          3.5,
          -3
        ],
        "size": [
          4,
          30,
          6
        ],
        "uv": [
          60,
          21
        ],
        "name": "right_arm",
        "pivot": [
          0,
          31,
          0
        ]
      },
      {
        "origin": [
          1.5,
          0,
          -3
        ],
        "size": [
          6,
          16,
          5
        ],
        "uv": [
          60,
          0
        ],
        "name": "left_leg",
        "mirror": true,
        "pivot": [
          5,
          13,
          0
        ]
      },
      {
        "origin": [
          9,
          3.5,
          -3
        ],
        "size": [
          4,
          30,
          6
        ],
        "uv": [
          60,
          58
        ],
        "name": "left_arm",
        "pivot": [
          0,
          31,
          0
        ]
      },
      {
        "origin": [
          -7.5,
          0,
          -3
        ],
        "size": [
          6,
          16,
          5
        ],
        "uv": [
          37,
          0
        ],
        "name": "right_leg",
        "pivot": [
          -4,
          13,
          0
        ]
      },
      {
        "origin": [
          -9,
          21,
          -6
        ],
        "size": [
          18,
          12,
          11
        ],
        "uv": [
          0,
          40
        ],
        "name": "body",
        "pivot": [
          0,
          31,
          0
        ]
      },
      {
        "origin": [
          -4.5,
          16,
          -3
        ],
        "size": [
          9,
          5,
          6
        ],
        "uv": [
          0,
          70
        ],
        "name": "body",
        "inflate": 0.5,
        "pivot": [
          0,
          31,
          0
        ]
      }
    ]
  },
  "snow_golem": {
    "id": "snow_golem",
    "textureSize": [
      64,
      64
    ],
    "cubes": [
      {
        "origin": [
          -4,
          20,
          -4
        ],
        "size": [
          8,
          8,
          8
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "inflate": -0.5,
        "pivot": [
          0,
          20,
          0
        ]
      },
      {
        "origin": [
          -6,
          16,
          -2
        ],
        "size": [
          12,
          2,
          2
        ],
        "uv": [
          32,
          0
        ],
        "name": "right_arm",
        "inflate": -0.5,
        "pivot": [
          -5,
          18,
          -1
        ],
        "rotation": [
          0,
          -180,
          -57.296
        ]
      },
      {
        "origin": [
          -5,
          11,
          -5
        ],
        "size": [
          10,
          10,
          10
        ],
        "uv": [
          0,
          16
        ],
        "name": "upper_body",
        "inflate": -0.5,
        "pivot": [
          0,
          11,
          0
        ]
      },
      {
        "origin": [
          4,
          16,
          0
        ],
        "size": [
          12,
          2,
          2
        ],
        "uv": [
          32,
          0
        ],
        "name": "left_arm",
        "inflate": -0.5,
        "pivot": [
          5,
          18,
          1
        ],
        "rotation": [
          0,
          0,
          57.296
        ]
      },
      {
        "origin": [
          -6,
          0,
          -6
        ],
        "size": [
          12,
          12,
          12
        ],
        "uv": [
          0,
          36
        ],
        "name": "lower_body",
        "inflate": -0.5,
        "pivot": [
          0,
          0,
          0
        ]
      }
    ]
  },
  "blaze": {
    "id": "blaze",
    "textureSize": [
      64,
      32
    ],
    "cubes": [
      {
        "origin": [
          9,
          17,
          0
        ],
        "size": [
          2,
          8,
          2
        ],
        "uv": [
          0,
          16
        ],
        "name": "part0",
        "pivot": [
          9,
          25,
          0
        ]
      },
      {
        "origin": [
          4.863,
          17.122,
          7.573
        ],
        "size": [
          2,
          8,
          2
        ],
        "uv": [
          0,
          16
        ],
        "name": "part1",
        "pivot": [
          4.863,
          25.122,
          7.573
        ]
      },
      {
        "origin": [
          -3.745,
          17.46,
          8.184
        ],
        "size": [
          2,
          8,
          2
        ],
        "uv": [
          0,
          16
        ],
        "name": "part2",
        "pivot": [
          -3.745,
          25.46,
          8.184
        ]
      },
      {
        "origin": [
          -4,
          20,
          -4
        ],
        "size": [
          8,
          8,
          8
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          -8.91,
          17.929,
          1.27
        ],
        "size": [
          2,
          8,
          2
        ],
        "uv": [
          0,
          16
        ],
        "name": "part3",
        "pivot": [
          -8.91,
          25.929,
          1.27
        ]
      },
      {
        "origin": [
          -4.731,
          5.386,
          -1.618
        ],
        "size": [
          2,
          8,
          2
        ],
        "uv": [
          0,
          16
        ],
        "name": "part11",
        "pivot": [
          -4.731,
          13.386,
          -1.618
        ]
      },
      {
        "origin": [
          4.95,
          14.416,
          4.95
        ],
        "size": [
          2,
          8,
          2
        ],
        "uv": [
          0,
          16
        ],
        "name": "part4",
        "pivot": [
          4.95,
          22.416,
          4.95
        ]
      },
      {
        "origin": [
          -3.918,
          4.653,
          3.107
        ],
        "size": [
          2,
          8,
          2
        ],
        "uv": [
          0,
          16
        ],
        "name": "part10",
        "pivot": [
          -3.918,
          12.653,
          3.107
        ]
      },
      {
        "origin": [
          -1.49,
          14.801,
          6.839
        ],
        "size": [
          2,
          8,
          2
        ],
        "uv": [
          0,
          16
        ],
        "name": "part5",
        "pivot": [
          -1.49,
          22.801,
          6.839
        ]
      },
      {
        "origin": [
          -6.56,
          14.99,
          2.441
        ],
        "size": [
          2,
          8,
          2
        ],
        "uv": [
          0,
          16
        ],
        "name": "part6",
        "pivot": [
          -6.56,
          22.99,
          2.441
        ]
      },
      {
        "origin": [
          -5.599,
          14.936,
          -4.202
        ],
        "size": [
          2,
          8,
          2
        ],
        "uv": [
          0,
          16
        ],
        "name": "part7",
        "pivot": [
          -5.599,
          22.936,
          -4.202
        ]
      },
      {
        "origin": [
          4.455,
          4.04,
          2.27
        ],
        "size": [
          2,
          8,
          2
        ],
        "uv": [
          0,
          16
        ],
        "name": "part8",
        "pivot": [
          4.455,
          12.04,
          2.27
        ]
      },
      {
        "origin": [
          0.497,
          4.107,
          4.975
        ],
        "size": [
          2,
          8,
          2
        ],
        "uv": [
          0,
          16
        ],
        "name": "part9",
        "pivot": [
          0.497,
          12.107,
          4.975
        ]
      }
    ]
  },
  "slime": {
    "id": "slime",
    "textureSize": [
      64,
      32
    ],
    "cubes": [
      {
        "origin": [
          -3.25,
          4,
          -3.5
        ],
        "size": [
          2,
          2,
          2
        ],
        "uv": [
          32,
          0
        ],
        "name": "right_eye",
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          0,
          2,
          -3.5
        ],
        "size": [
          1,
          1,
          1
        ],
        "uv": [
          32,
          8
        ],
        "name": "mouth",
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          1.25,
          4,
          -3.5
        ],
        "size": [
          2,
          2,
          2
        ],
        "uv": [
          32,
          4
        ],
        "name": "left_eye",
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          -3,
          1,
          -3
        ],
        "size": [
          6,
          6,
          6
        ],
        "uv": [
          0,
          16
        ],
        "name": "cube",
        "pivot": [
          0,
          24,
          0
        ]
      }
    ]
  },
  "magma_cube": {
    "id": "magma_cube",
    "textureSize": [
      64,
      32
    ],
    "cubes": [
      {
        "origin": [
          -4,
          7,
          -4
        ],
        "size": [
          8,
          1,
          8
        ],
        "uv": [
          0,
          0
        ],
        "name": "cube0",
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          -4,
          5,
          -4
        ],
        "size": [
          8,
          1,
          8
        ],
        "uv": [
          24,
          10
        ],
        "name": "cube2",
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          -4,
          6,
          -4
        ],
        "size": [
          8,
          1,
          8
        ],
        "uv": [
          0,
          1
        ],
        "name": "cube1",
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          -4,
          3,
          -4
        ],
        "size": [
          8,
          1,
          8
        ],
        "uv": [
          0,
          4
        ],
        "name": "cube4",
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          -4,
          4,
          -4
        ],
        "size": [
          8,
          1,
          8
        ],
        "uv": [
          24,
          19
        ],
        "name": "cube3",
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          -4,
          1,
          -4
        ],
        "size": [
          8,
          1,
          8
        ],
        "uv": [
          0,
          6
        ],
        "name": "cube6",
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          -4,
          2,
          -4
        ],
        "size": [
          8,
          1,
          8
        ],
        "uv": [
          0,
          5
        ],
        "name": "cube5",
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          -4,
          0,
          -4
        ],
        "size": [
          8,
          1,
          8
        ],
        "uv": [
          0,
          7
        ],
        "name": "cube7",
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          -2,
          2,
          -2
        ],
        "size": [
          4,
          4,
          4
        ],
        "uv": [
          0,
          16
        ],
        "name": "inside_cube",
        "pivot": [
          0,
          24,
          0
        ]
      }
    ]
  },
  "spider": {
    "id": "spider",
    "textureSize": [
      64,
      32
    ],
    "cubes": [
      {
        "origin": [
          -4,
          5,
          -11
        ],
        "size": [
          8,
          8,
          8
        ],
        "uv": [
          32,
          4
        ],
        "name": "head",
        "pivot": [
          0,
          9,
          -3
        ]
      },
      {
        "origin": [
          -19,
          8,
          -2
        ],
        "size": [
          16,
          2,
          2
        ],
        "uv": [
          18,
          0
        ],
        "name": "right_front_leg",
        "pivot": [
          -4,
          9,
          -1
        ]
      },
      {
        "origin": [
          -19,
          8,
          1
        ],
        "size": [
          16,
          2,
          2
        ],
        "uv": [
          18,
          0
        ],
        "name": "right_hind_leg",
        "pivot": [
          -4,
          9,
          2
        ]
      },
      {
        "origin": [
          3,
          8,
          -1
        ],
        "size": [
          16,
          2,
          2
        ],
        "uv": [
          18,
          0
        ],
        "name": "left_middle_front_leg",
        "mirror": true,
        "pivot": [
          4,
          9,
          0
        ]
      },
      {
        "origin": [
          -3,
          6,
          -3
        ],
        "size": [
          6,
          6,
          6
        ],
        "uv": [
          0,
          0
        ],
        "name": "body0",
        "pivot": [
          0,
          9,
          0
        ]
      },
      {
        "origin": [
          -5,
          5,
          3
        ],
        "size": [
          10,
          8,
          12
        ],
        "uv": [
          0,
          12
        ],
        "name": "body1",
        "pivot": [
          0,
          9,
          9
        ]
      },
      {
        "origin": [
          3,
          8,
          1
        ],
        "size": [
          16,
          2,
          2
        ],
        "uv": [
          18,
          0
        ],
        "name": "left_hind_leg",
        "mirror": true,
        "pivot": [
          4,
          9,
          2
        ]
      },
      {
        "origin": [
          -19,
          8,
          0
        ],
        "size": [
          16,
          2,
          2
        ],
        "uv": [
          18,
          0
        ],
        "name": "right_middle_hind_leg",
        "pivot": [
          -4,
          9,
          1
        ]
      },
      {
        "origin": [
          -19,
          8,
          -1
        ],
        "size": [
          16,
          2,
          2
        ],
        "uv": [
          18,
          0
        ],
        "name": "right_middle_front_leg",
        "pivot": [
          -4,
          9,
          0
        ]
      },
      {
        "origin": [
          3,
          8,
          0
        ],
        "size": [
          16,
          2,
          2
        ],
        "uv": [
          18,
          0
        ],
        "name": "left_middle_hind_leg",
        "mirror": true,
        "pivot": [
          4,
          9,
          1
        ]
      },
      {
        "origin": [
          3,
          8,
          -2
        ],
        "size": [
          16,
          2,
          2
        ],
        "uv": [
          18,
          0
        ],
        "name": "left_front_leg",
        "mirror": true,
        "pivot": [
          4,
          9,
          -1
        ]
      }
    ]
  },
  "cave_spider": {
    "id": "cave_spider",
    "textureSize": [
      64,
      32
    ],
    "cubes": [
      {
        "origin": [
          -4,
          5,
          -11
        ],
        "size": [
          8,
          8,
          8
        ],
        "uv": [
          32,
          4
        ],
        "name": "head",
        "pivot": [
          0,
          9,
          -3
        ]
      },
      {
        "origin": [
          -19,
          8,
          -2
        ],
        "size": [
          16,
          2,
          2
        ],
        "uv": [
          18,
          0
        ],
        "name": "right_front_leg",
        "pivot": [
          -4,
          9,
          -1
        ]
      },
      {
        "origin": [
          -19,
          8,
          1
        ],
        "size": [
          16,
          2,
          2
        ],
        "uv": [
          18,
          0
        ],
        "name": "right_hind_leg",
        "pivot": [
          -4,
          9,
          2
        ]
      },
      {
        "origin": [
          3,
          8,
          -1
        ],
        "size": [
          16,
          2,
          2
        ],
        "uv": [
          18,
          0
        ],
        "name": "left_middle_front_leg",
        "mirror": true,
        "pivot": [
          4,
          9,
          0
        ]
      },
      {
        "origin": [
          -3,
          6,
          -3
        ],
        "size": [
          6,
          6,
          6
        ],
        "uv": [
          0,
          0
        ],
        "name": "body0",
        "pivot": [
          0,
          9,
          0
        ]
      },
      {
        "origin": [
          -5,
          5,
          3
        ],
        "size": [
          10,
          8,
          12
        ],
        "uv": [
          0,
          12
        ],
        "name": "body1",
        "pivot": [
          0,
          9,
          9
        ]
      },
      {
        "origin": [
          3,
          8,
          1
        ],
        "size": [
          16,
          2,
          2
        ],
        "uv": [
          18,
          0
        ],
        "name": "left_hind_leg",
        "mirror": true,
        "pivot": [
          4,
          9,
          2
        ]
      },
      {
        "origin": [
          -19,
          8,
          0
        ],
        "size": [
          16,
          2,
          2
        ],
        "uv": [
          18,
          0
        ],
        "name": "right_middle_hind_leg",
        "pivot": [
          -4,
          9,
          1
        ]
      },
      {
        "origin": [
          -19,
          8,
          -1
        ],
        "size": [
          16,
          2,
          2
        ],
        "uv": [
          18,
          0
        ],
        "name": "right_middle_front_leg",
        "pivot": [
          -4,
          9,
          0
        ]
      },
      {
        "origin": [
          3,
          8,
          0
        ],
        "size": [
          16,
          2,
          2
        ],
        "uv": [
          18,
          0
        ],
        "name": "left_middle_hind_leg",
        "mirror": true,
        "pivot": [
          4,
          9,
          1
        ]
      },
      {
        "origin": [
          3,
          8,
          -2
        ],
        "size": [
          16,
          2,
          2
        ],
        "uv": [
          18,
          0
        ],
        "name": "left_front_leg",
        "mirror": true,
        "pivot": [
          4,
          9,
          -1
        ]
      }
    ]
  },
  "ghast": {
    "id": "ghast",
    "textureSize": [
      64,
      32
    ],
    "cubes": [
      {
        "origin": [
          -4.75,
          -8.6,
          -6
        ],
        "size": [
          2,
          8,
          2
        ],
        "uv": [
          0,
          0
        ],
        "name": "tentacle0",
        "pivot": [
          -3.75,
          -0.6,
          -5
        ]
      },
      {
        "origin": [
          0.25,
          -13.6,
          -6
        ],
        "size": [
          2,
          13,
          2
        ],
        "uv": [
          0,
          0
        ],
        "name": "tentacle1",
        "pivot": [
          1.25,
          -0.6,
          -5
        ]
      },
      {
        "origin": [
          5.25,
          -12.6,
          4
        ],
        "size": [
          2,
          12,
          2
        ],
        "uv": [
          0,
          0
        ],
        "name": "tentacle8",
        "pivot": [
          6.25,
          -0.6,
          5
        ]
      },
      {
        "origin": [
          -4.75,
          -12.6,
          4
        ],
        "size": [
          2,
          12,
          2
        ],
        "uv": [
          0,
          0
        ],
        "name": "tentacle6",
        "pivot": [
          -3.75,
          -0.6,
          5
        ]
      },
      {
        "origin": [
          0.25,
          -9.6,
          4
        ],
        "size": [
          2,
          9,
          2
        ],
        "uv": [
          0,
          0
        ],
        "name": "tentacle7",
        "pivot": [
          1.25,
          -0.6,
          5
        ]
      },
      {
        "origin": [
          -8,
          -1.6,
          -8
        ],
        "size": [
          16,
          16,
          16
        ],
        "uv": [
          0,
          0
        ],
        "name": "body",
        "pivot": [
          0,
          6.4,
          0
        ]
      },
      {
        "origin": [
          -2.25,
          -11.6,
          -1
        ],
        "size": [
          2,
          11,
          2
        ],
        "uv": [
          0,
          0
        ],
        "name": "tentacle4",
        "pivot": [
          -1.25,
          -0.6,
          0
        ]
      },
      {
        "origin": [
          2.75,
          -10.6,
          -1
        ],
        "size": [
          2,
          10,
          2
        ],
        "uv": [
          0,
          0
        ],
        "name": "tentacle5",
        "pivot": [
          3.75,
          -0.6,
          0
        ]
      },
      {
        "origin": [
          5.25,
          -9.6,
          -6
        ],
        "size": [
          2,
          9,
          2
        ],
        "uv": [
          0,
          0
        ],
        "name": "tentacle2",
        "pivot": [
          6.25,
          -0.6,
          -5
        ]
      },
      {
        "origin": [
          -7.25,
          -11.6,
          -1
        ],
        "size": [
          2,
          11,
          2
        ],
        "uv": [
          0,
          0
        ],
        "name": "tentacle3",
        "pivot": [
          -6.25,
          -0.6,
          0
        ]
      }
    ]
  },
  "cow": {
    "id": "cow",
    "textureSize": [
      64,
      64
    ],
    "cubes": [
      {
        "origin": [
          -4,
          16,
          -15
        ],
        "size": [
          8,
          8,
          6
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "pivot": [
          0,
          20,
          -9
        ]
      },
      {
        "origin": [
          -3,
          16,
          -16
        ],
        "size": [
          6,
          3,
          1
        ],
        "uv": [
          1,
          33
        ],
        "name": "head",
        "pivot": [
          0,
          20,
          -9
        ]
      },
      {
        "origin": [
          -5,
          22,
          -14
        ],
        "size": [
          1,
          3,
          1
        ],
        "uv": [
          22,
          0
        ],
        "name": "head",
        "pivot": [
          0,
          20,
          -9
        ]
      },
      {
        "origin": [
          4,
          22,
          -14
        ],
        "size": [
          1,
          3,
          1
        ],
        "uv": [
          22,
          0
        ],
        "name": "head",
        "pivot": [
          0,
          20,
          -9
        ]
      },
      {
        "origin": [
          -6,
          29,
          14
        ],
        "size": [
          12,
          18,
          10
        ],
        "uv": [
          18,
          4
        ],
        "name": "body",
        "pivot": [
          0,
          18,
          20
        ],
        "rotation": [
          -90,
          0,
          0
        ]
      },
      {
        "origin": [
          -2,
          29,
          13
        ],
        "size": [
          4,
          6,
          1
        ],
        "uv": [
          52,
          0
        ],
        "name": "body",
        "pivot": [
          0,
          18,
          20
        ],
        "rotation": [
          -90,
          0,
          0
        ]
      },
      {
        "origin": [
          -6,
          0,
          4
        ],
        "size": [
          4,
          12,
          4
        ],
        "uv": [
          0,
          16
        ],
        "name": "leg0",
        "pivot": [
          -4,
          12,
          6
        ]
      },
      {
        "origin": [
          2,
          0,
          4
        ],
        "size": [
          4,
          12,
          4
        ],
        "uv": [
          0,
          16
        ],
        "name": "leg1",
        "mirror": true,
        "pivot": [
          4,
          12,
          6
        ]
      },
      {
        "origin": [
          -6,
          0,
          -8
        ],
        "size": [
          4,
          12,
          4
        ],
        "uv": [
          0,
          16
        ],
        "name": "leg2",
        "pivot": [
          -4,
          12,
          -7
        ]
      },
      {
        "origin": [
          2,
          0,
          -8
        ],
        "size": [
          4,
          12,
          4
        ],
        "uv": [
          0,
          16
        ],
        "name": "leg3",
        "mirror": true,
        "pivot": [
          4,
          12,
          -7
        ]
      }
    ]
  },
  "pig": {
    "id": "pig",
    "textureSize": [
      64,
      64
    ],
    "cubes": [
      {
        "origin": [
          -4,
          8,
          -15
        ],
        "size": [
          8,
          8,
          8
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "pivot": [
          0,
          12,
          -7
        ]
      },
      {
        "origin": [
          -2,
          9,
          -16
        ],
        "size": [
          4,
          3,
          1
        ],
        "uv": [
          16,
          16
        ],
        "name": "head",
        "pivot": [
          0,
          12,
          -7
        ]
      },
      {
        "origin": [
          -5,
          2,
          -5
        ],
        "size": [
          10,
          16,
          8
        ],
        "uv": [
          28,
          32
        ],
        "name": "body",
        "inflate": 0.5,
        "pivot": [
          0,
          0,
          0
        ],
        "rotation": [
          -90,
          0,
          0
        ]
      },
      {
        "origin": [
          -5,
          2,
          -5
        ],
        "size": [
          10,
          16,
          8
        ],
        "uv": [
          28,
          8
        ],
        "name": "body",
        "pivot": [
          0,
          0,
          0
        ],
        "rotation": [
          -90,
          0,
          0
        ]
      },
      {
        "origin": [
          -5,
          0,
          4
        ],
        "size": [
          4,
          6,
          4
        ],
        "uv": [
          0,
          16
        ],
        "name": "leg0",
        "pivot": [
          -3,
          6,
          6
        ]
      },
      {
        "origin": [
          1,
          0,
          4
        ],
        "size": [
          4,
          6,
          4
        ],
        "uv": [
          0,
          16
        ],
        "name": "leg1",
        "mirror": true,
        "pivot": [
          3,
          6,
          6
        ]
      },
      {
        "origin": [
          1,
          0,
          -8
        ],
        "size": [
          4,
          6,
          4
        ],
        "uv": [
          0,
          16
        ],
        "name": "leg3",
        "mirror": true,
        "pivot": [
          3,
          6,
          -6
        ]
      },
      {
        "origin": [
          -5,
          0,
          -8
        ],
        "size": [
          4,
          6,
          4
        ],
        "uv": [
          0,
          16
        ],
        "name": "leg2",
        "pivot": [
          -3,
          6,
          -6
        ]
      }
    ]
  },
  "sheep": {
    "id": "sheep",
    "textureSize": [
      64,
      32
    ],
    "cubes": [
      {
        "origin": [
          -3,
          16,
          -14
        ],
        "size": [
          6,
          6,
          8
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "pivot": [
          0,
          18,
          -8
        ]
      },
      {
        "origin": [
          -5,
          0,
          -7
        ],
        "size": [
          4,
          12,
          4
        ],
        "uv": [
          0,
          16
        ],
        "name": "right_front_leg",
        "pivot": [
          -3,
          12,
          -5
        ]
      },
      {
        "origin": [
          -5,
          0,
          5
        ],
        "size": [
          4,
          12,
          4
        ],
        "uv": [
          0,
          16
        ],
        "name": "right_hind_leg",
        "pivot": [
          -3,
          12,
          7
        ]
      },
      {
        "origin": [
          1,
          0,
          5
        ],
        "size": [
          4,
          12,
          4
        ],
        "uv": [
          0,
          16
        ],
        "name": "left_hind_leg",
        "pivot": [
          3,
          12,
          7
        ]
      },
      {
        "origin": [
          -4,
          13,
          -5
        ],
        "size": [
          8,
          16,
          6
        ],
        "uv": [
          28,
          8
        ],
        "name": "body",
        "pivot": [
          0,
          19,
          2
        ],
        "rotation": [
          -90,
          0,
          0
        ]
      },
      {
        "origin": [
          1,
          0,
          -7
        ],
        "size": [
          4,
          12,
          4
        ],
        "uv": [
          0,
          16
        ],
        "name": "left_front_leg",
        "pivot": [
          3,
          12,
          -5
        ]
      }
    ]
  },
  "chicken": {
    "id": "chicken",
    "textureSize": [
      64,
      32
    ],
    "cubes": [
      {
        "origin": [
          -2,
          9,
          -6
        ],
        "size": [
          4,
          6,
          3
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "pivot": [
          0,
          9,
          -4
        ]
      },
      {
        "origin": [
          -2,
          11,
          -8
        ],
        "size": [
          4,
          2,
          2
        ],
        "uv": [
          14,
          0
        ],
        "name": "beak",
        "pivot": [
          0,
          9,
          -4
        ]
      },
      {
        "origin": [
          0,
          0,
          -2
        ],
        "size": [
          3,
          5,
          3
        ],
        "uv": [
          26,
          0
        ],
        "name": "left_leg",
        "pivot": [
          1,
          5,
          1
        ]
      },
      {
        "origin": [
          -3,
          0,
          -2
        ],
        "size": [
          3,
          5,
          3
        ],
        "uv": [
          26,
          0
        ],
        "name": "right_leg",
        "pivot": [
          -2,
          5,
          1
        ]
      },
      {
        "origin": [
          -4,
          7,
          -3
        ],
        "size": [
          1,
          4,
          6
        ],
        "uv": [
          24,
          13
        ],
        "name": "right_wing",
        "pivot": [
          -4,
          11,
          0
        ]
      },
      {
        "origin": [
          3,
          7,
          -3
        ],
        "size": [
          1,
          4,
          6
        ],
        "uv": [
          24,
          13
        ],
        "name": "left_wing",
        "pivot": [
          4,
          11,
          0
        ]
      },
      {
        "origin": [
          -3,
          4,
          -3
        ],
        "size": [
          6,
          8,
          6
        ],
        "uv": [
          0,
          9
        ],
        "name": "body",
        "pivot": [
          0,
          8,
          0
        ],
        "rotation": [
          -90,
          0,
          0
        ]
      },
      {
        "origin": [
          -1,
          9,
          -7
        ],
        "size": [
          2,
          2,
          2
        ],
        "uv": [
          14,
          4
        ],
        "name": "red_thing",
        "pivot": [
          0,
          9,
          -4
        ]
      }
    ]
  },
  "wolf": {
    "id": "wolf",
    "textureSize": [
      64,
      32
    ],
    "cubes": [
      {
        "origin": [
          -3,
          7.5,
          -9
        ],
        "size": [
          6,
          6,
          4
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "poseParent": "body",
        "pivot": [
          -1,
          10.5,
          -7
        ]
      },
      {
        "origin": [
          -3,
          13.5,
          -7
        ],
        "size": [
          2,
          2,
          1
        ],
        "uv": [
          16,
          14
        ],
        "name": "head",
        "poseParent": "body",
        "pivot": [
          -1,
          10.5,
          -7
        ]
      },
      {
        "origin": [
          1,
          13.5,
          -7
        ],
        "size": [
          2,
          2,
          1
        ],
        "uv": [
          16,
          14
        ],
        "name": "head",
        "poseParent": "body",
        "pivot": [
          -1,
          10.5,
          -7
        ]
      },
      {
        "origin": [
          -1.5,
          7.516,
          -12
        ],
        "size": [
          3,
          3,
          4
        ],
        "uv": [
          0,
          10
        ],
        "name": "head",
        "poseParent": "body",
        "pivot": [
          -1,
          10.5,
          -7
        ]
      },
      {
        "origin": [
          -3,
          3,
          -1
        ],
        "size": [
          6,
          9,
          6
        ],
        "uv": [
          18,
          14
        ],
        "name": "body",
        "pivot": [
          0,
          10,
          2
        ]
      },
      {
        "origin": [
          -4,
          7,
          -1
        ],
        "size": [
          8,
          6,
          7
        ],
        "uv": [
          21,
          0
        ],
        "name": "upper_body",
        "poseParent": "body",
        "pivot": [
          -1,
          10,
          2
        ]
      },
      {
        "origin": [
          -2.5,
          0,
          6
        ],
        "size": [
          2,
          8,
          2
        ],
        "uv": [
          0,
          18
        ],
        "name": "leg0",
        "poseParent": "body",
        "pivot": [
          -2.5,
          8,
          7
        ]
      },
      {
        "origin": [
          0.5,
          0,
          6
        ],
        "size": [
          2,
          8,
          2
        ],
        "uv": [
          0,
          18
        ],
        "name": "leg1",
        "poseParent": "body",
        "pivot": [
          0.5,
          8,
          7
        ]
      },
      {
        "origin": [
          -2.5,
          0,
          -5
        ],
        "size": [
          2,
          8,
          2
        ],
        "uv": [
          0,
          18
        ],
        "name": "leg2",
        "poseParent": "body",
        "pivot": [
          -2.5,
          8,
          -4
        ]
      },
      {
        "origin": [
          0.5,
          0,
          -5
        ],
        "size": [
          2,
          8,
          2
        ],
        "uv": [
          0,
          18
        ],
        "name": "leg3",
        "poseParent": "body",
        "pivot": [
          0.5,
          8,
          -4
        ]
      },
      {
        "origin": [
          -1,
          4,
          7
        ],
        "size": [
          2,
          8,
          2
        ],
        "uv": [
          9,
          18
        ],
        "name": "tail",
        "poseParent": "body",
        "pivot": [
          -1,
          12,
          8
        ]
      }
    ]
  },
  "hoglin": {
    "id": "hoglin",
    "textureSize": [
      128,
      64
    ],
    "cubes": [
      {
        "origin": [
          -7,
          19,
          -31
        ],
        "size": [
          14,
          6,
          19
        ],
        "uv": [
          61,
          1
        ],
        "name": "head",
        "pivot": [
          0,
          22,
          -12
        ],
        "rotation": [
          -50,
          0,
          0
        ]
      },
      {
        "origin": [
          -8,
          20,
          -25
        ],
        "size": [
          2,
          11,
          2
        ],
        "uv": [
          10,
          13
        ],
        "name": "right_horn",
        "poseParent": "head",
        "pivot": [
          -7,
          20,
          -24
        ],
        "parents": [
          {
            "pivot": [
              0,
              22,
              -12
            ],
            "rotation": [
              -50,
              0,
              0
            ]
          }
        ]
      },
      {
        "origin": [
          6,
          20,
          -25
        ],
        "size": [
          2,
          11,
          2
        ],
        "uv": [
          1,
          13
        ],
        "name": "left_horn",
        "poseParent": "head",
        "pivot": [
          7,
          20,
          -24
        ],
        "parents": [
          {
            "pivot": [
              0,
              22,
              -12
            ],
            "rotation": [
              -50,
              0,
              0
            ]
          }
        ]
      },
      {
        "origin": [
          -12,
          24,
          -17
        ],
        "size": [
          6,
          1,
          4
        ],
        "uv": [
          1,
          1
        ],
        "name": "right_ear",
        "poseParent": "head",
        "pivot": [
          -6,
          24,
          -15
        ],
        "rotation": [
          0,
          0,
          -40
        ],
        "parents": [
          {
            "pivot": [
              0,
              22,
              -12
            ],
            "rotation": [
              -50,
              0,
              0
            ]
          }
        ]
      },
      {
        "origin": [
          6,
          24,
          -17
        ],
        "size": [
          6,
          1,
          4
        ],
        "uv": [
          1,
          6
        ],
        "name": "left_ear",
        "poseParent": "head",
        "pivot": [
          6,
          24,
          -15
        ],
        "rotation": [
          0,
          0,
          40
        ],
        "parents": [
          {
            "pivot": [
              0,
              22,
              -12
            ],
            "rotation": [
              -50,
              0,
              0
            ]
          }
        ]
      },
      {
        "origin": [
          -7,
          0,
          -11.5
        ],
        "size": [
          6,
          14,
          6
        ],
        "uv": [
          66,
          42
        ],
        "name": "right_front_leg",
        "pivot": [
          -4,
          14,
          -8.5
        ]
      },
      {
        "origin": [
          -7.5,
          0,
          7.5
        ],
        "size": [
          5,
          11,
          5
        ],
        "uv": [
          21,
          45
        ],
        "name": "right_hind_leg",
        "pivot": [
          -5,
          11,
          10
        ]
      },
      {
        "origin": [
          2.5,
          0,
          7.5
        ],
        "size": [
          5,
          11,
          5
        ],
        "uv": [
          0,
          45
        ],
        "name": "left_hind_leg",
        "pivot": [
          5,
          11,
          10
        ]
      },
      {
        "origin": [
          -8,
          10,
          -13
        ],
        "size": [
          16,
          14,
          26
        ],
        "uv": [
          1,
          1
        ],
        "name": "body",
        "pivot": [
          0,
          17,
          0
        ]
      },
      {
        "origin": [
          0,
          21,
          -14
        ],
        "size": [
          0,
          10,
          19
        ],
        "uv": [
          90,
          33
        ],
        "name": "mane",
        "poseParent": "body",
        "pivot": [
          0,
          31,
          -5
        ]
      },
      {
        "origin": [
          1,
          0,
          -11.5
        ],
        "size": [
          6,
          14,
          6
        ],
        "uv": [
          41,
          42
        ],
        "name": "left_front_leg",
        "pivot": [
          4,
          14,
          -8.5
        ]
      }
    ]
  },
  "zoglin": {
    "id": "zoglin",
    "textureSize": [
      128,
      64
    ],
    "cubes": [
      {
        "origin": [
          -7,
          19,
          -31
        ],
        "size": [
          14,
          6,
          19
        ],
        "uv": [
          61,
          1
        ],
        "name": "head",
        "pivot": [
          0,
          22,
          -12
        ],
        "rotation": [
          -50,
          0,
          0
        ]
      },
      {
        "origin": [
          -8,
          20,
          -25
        ],
        "size": [
          2,
          11,
          2
        ],
        "uv": [
          10,
          13
        ],
        "name": "right_horn",
        "poseParent": "head",
        "pivot": [
          -7,
          20,
          -24
        ],
        "parents": [
          {
            "pivot": [
              0,
              22,
              -12
            ],
            "rotation": [
              -50,
              0,
              0
            ]
          }
        ]
      },
      {
        "origin": [
          6,
          20,
          -25
        ],
        "size": [
          2,
          11,
          2
        ],
        "uv": [
          1,
          13
        ],
        "name": "left_horn",
        "poseParent": "head",
        "pivot": [
          7,
          20,
          -24
        ],
        "parents": [
          {
            "pivot": [
              0,
              22,
              -12
            ],
            "rotation": [
              -50,
              0,
              0
            ]
          }
        ]
      },
      {
        "origin": [
          -12,
          24,
          -17
        ],
        "size": [
          6,
          1,
          4
        ],
        "uv": [
          1,
          1
        ],
        "name": "right_ear",
        "poseParent": "head",
        "pivot": [
          -6,
          24,
          -15
        ],
        "rotation": [
          0,
          0,
          -40
        ],
        "parents": [
          {
            "pivot": [
              0,
              22,
              -12
            ],
            "rotation": [
              -50,
              0,
              0
            ]
          }
        ]
      },
      {
        "origin": [
          6,
          24,
          -17
        ],
        "size": [
          6,
          1,
          4
        ],
        "uv": [
          1,
          6
        ],
        "name": "left_ear",
        "poseParent": "head",
        "pivot": [
          6,
          24,
          -15
        ],
        "rotation": [
          0,
          0,
          40
        ],
        "parents": [
          {
            "pivot": [
              0,
              22,
              -12
            ],
            "rotation": [
              -50,
              0,
              0
            ]
          }
        ]
      },
      {
        "origin": [
          -7,
          0,
          -11.5
        ],
        "size": [
          6,
          14,
          6
        ],
        "uv": [
          66,
          42
        ],
        "name": "right_front_leg",
        "pivot": [
          -4,
          14,
          -8.5
        ]
      },
      {
        "origin": [
          -7.5,
          0,
          7.5
        ],
        "size": [
          5,
          11,
          5
        ],
        "uv": [
          21,
          45
        ],
        "name": "right_hind_leg",
        "pivot": [
          -5,
          11,
          10
        ]
      },
      {
        "origin": [
          2.5,
          0,
          7.5
        ],
        "size": [
          5,
          11,
          5
        ],
        "uv": [
          0,
          45
        ],
        "name": "left_hind_leg",
        "pivot": [
          5,
          11,
          10
        ]
      },
      {
        "origin": [
          -8,
          10,
          -13
        ],
        "size": [
          16,
          14,
          26
        ],
        "uv": [
          1,
          1
        ],
        "name": "body",
        "pivot": [
          0,
          17,
          0
        ]
      },
      {
        "origin": [
          0,
          21,
          -14
        ],
        "size": [
          0,
          10,
          19
        ],
        "uv": [
          90,
          33
        ],
        "name": "mane",
        "poseParent": "body",
        "pivot": [
          0,
          31,
          -5
        ]
      },
      {
        "origin": [
          1,
          0,
          -11.5
        ],
        "size": [
          6,
          14,
          6
        ],
        "uv": [
          41,
          42
        ],
        "name": "left_front_leg",
        "pivot": [
          4,
          14,
          -8.5
        ]
      }
    ]
  },
  "bee": {
    "id": "bee",
    "textureSize": [
      64,
      64
    ],
    "cubes": [
      {
        "origin": [
          -3.5,
          0,
          -2
        ],
        "size": [
          7,
          2,
          0
        ],
        "uv": [
          26,
          1
        ],
        "name": "front_legs",
        "poseParent": "bone",
        "pivot": [
          1.5,
          2,
          -2
        ]
      },
      {
        "origin": [
          -10.5,
          9,
          -3
        ],
        "size": [
          9,
          0,
          6
        ],
        "uv": [
          0,
          18
        ],
        "name": "right_wing",
        "poseParent": "bone",
        "pivot": [
          -1.5,
          9,
          -3
        ],
        "rotation": [
          0,
          15,
          0
        ]
      },
      {
        "origin": [
          1.5,
          9,
          -3
        ],
        "size": [
          9,
          0,
          6
        ],
        "uv": [
          0,
          18
        ],
        "name": "left_wing",
        "poseParent": "bone",
        "mirror": true,
        "pivot": [
          1.5,
          9,
          -3
        ],
        "rotation": [
          0,
          -15,
          0
        ]
      },
      {
        "origin": [
          -3.5,
          0,
          0
        ],
        "size": [
          7,
          2,
          0
        ],
        "uv": [
          26,
          3
        ],
        "name": "middle_legs",
        "poseParent": "bone",
        "pivot": [
          1.5,
          2,
          0
        ]
      },
      {
        "origin": [
          -3.5,
          2,
          -5
        ],
        "size": [
          7,
          7,
          10
        ],
        "uv": [
          0,
          0
        ],
        "name": "body",
        "poseParent": "bone",
        "pivot": [
          0,
          5,
          0
        ]
      },
      {
        "origin": [
          -2.5,
          7,
          -8
        ],
        "size": [
          1,
          2,
          3
        ],
        "uv": [
          2,
          3
        ],
        "name": "right_antenna",
        "poseParent": "body",
        "pivot": [
          0,
          7,
          -5
        ]
      },
      {
        "origin": [
          0,
          5,
          5
        ],
        "size": [
          0,
          1,
          2
        ],
        "uv": [
          26,
          7
        ],
        "name": "stinger",
        "poseParent": "body",
        "pivot": [
          0,
          5,
          0
        ]
      },
      {
        "origin": [
          1.5,
          7,
          -8
        ],
        "size": [
          1,
          2,
          3
        ],
        "uv": [
          2,
          0
        ],
        "name": "left_antenna",
        "poseParent": "body",
        "pivot": [
          0,
          7,
          -5
        ]
      },
      {
        "origin": [
          -3.5,
          0,
          2
        ],
        "size": [
          7,
          2,
          0
        ],
        "uv": [
          26,
          5
        ],
        "name": "back_legs",
        "poseParent": "bone",
        "pivot": [
          1.5,
          2,
          2
        ]
      }
    ]
  },
  "silverfish": {
    "id": "silverfish",
    "textureSize": [
      64,
      32
    ],
    "cubes": [
      {
        "origin": [
          -3,
          0,
          -0.5
        ],
        "size": [
          6,
          4,
          3
        ],
        "uv": [
          0,
          9
        ],
        "name": "segment2",
        "pivot": [
          0,
          4,
          1
        ]
      },
      {
        "origin": [
          -2,
          0,
          -2.5
        ],
        "size": [
          4,
          3,
          2
        ],
        "uv": [
          0,
          4
        ],
        "name": "segment1",
        "pivot": [
          0,
          3,
          -1.5
        ]
      },
      {
        "origin": [
          -1.5,
          0,
          -4.5
        ],
        "size": [
          3,
          2,
          2
        ],
        "uv": [
          0,
          0
        ],
        "name": "segment0",
        "pivot": [
          0,
          2,
          -3.5
        ]
      },
      {
        "origin": [
          -5,
          0,
          -0.5
        ],
        "size": [
          10,
          8,
          3
        ],
        "uv": [
          20,
          0
        ],
        "name": "layer0",
        "pivot": [
          0,
          8,
          1
        ]
      },
      {
        "origin": [
          -3,
          0,
          5.5
        ],
        "size": [
          6,
          4,
          3
        ],
        "uv": [
          20,
          11
        ],
        "name": "layer1",
        "pivot": [
          0,
          4,
          7
        ]
      },
      {
        "origin": [
          -3,
          0,
          -3
        ],
        "size": [
          6,
          5,
          2
        ],
        "uv": [
          20,
          18
        ],
        "name": "layer2",
        "pivot": [
          0,
          5,
          -1.5
        ]
      },
      {
        "origin": [
          -0.5,
          0,
          10.5
        ],
        "size": [
          1,
          1,
          2
        ],
        "uv": [
          13,
          4
        ],
        "name": "segment6",
        "pivot": [
          0,
          1,
          11.5
        ]
      },
      {
        "origin": [
          -1,
          0,
          8.5
        ],
        "size": [
          2,
          1,
          2
        ],
        "uv": [
          11,
          0
        ],
        "name": "segment5",
        "pivot": [
          0,
          1,
          9.5
        ]
      },
      {
        "origin": [
          -1,
          0,
          5.5
        ],
        "size": [
          2,
          2,
          3
        ],
        "uv": [
          0,
          22
        ],
        "name": "segment4",
        "pivot": [
          0,
          2,
          7
        ]
      },
      {
        "origin": [
          -1.5,
          0,
          2.5
        ],
        "size": [
          3,
          3,
          3
        ],
        "uv": [
          0,
          16
        ],
        "name": "segment3",
        "pivot": [
          0,
          3,
          4
        ]
      }
    ]
  },
  "endermite": {
    "id": "endermite",
    "textureSize": [
      64,
      32
    ],
    "cubes": [
      {
        "origin": [
          -1.5,
          0,
          2.5
        ],
        "size": [
          3,
          3,
          1
        ],
        "uv": [
          0,
          14
        ],
        "name": "segment2",
        "pivot": [
          0,
          3,
          3
        ]
      },
      {
        "origin": [
          -3,
          0,
          -2.5
        ],
        "size": [
          6,
          4,
          5
        ],
        "uv": [
          0,
          5
        ],
        "name": "segment1",
        "pivot": [
          0,
          4,
          0
        ]
      },
      {
        "origin": [
          -2,
          0,
          -4.5
        ],
        "size": [
          4,
          3,
          2
        ],
        "uv": [
          0,
          0
        ],
        "name": "segment0",
        "pivot": [
          0,
          3,
          -3.5
        ]
      },
      {
        "origin": [
          -0.5,
          0,
          3.5
        ],
        "size": [
          1,
          2,
          1
        ],
        "uv": [
          0,
          18
        ],
        "name": "segment3",
        "pivot": [
          0,
          2,
          4
        ]
      }
    ]
  },
  "guardian": {
    "id": "guardian",
    "textureSize": [
      64,
      64
    ],
    "cubes": [
      {
        "origin": [
          -6,
          2,
          -8
        ],
        "size": [
          12,
          12,
          16
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          -8,
          2,
          -6
        ],
        "size": [
          2,
          12,
          12
        ],
        "uv": [
          0,
          28
        ],
        "name": "head",
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          6,
          2,
          -6
        ],
        "size": [
          2,
          12,
          12
        ],
        "uv": [
          0,
          28
        ],
        "name": "head",
        "mirror": true,
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          -6,
          14,
          -6
        ],
        "size": [
          12,
          2,
          12
        ],
        "uv": [
          16,
          40
        ],
        "name": "head",
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          -6,
          0,
          -6
        ],
        "size": [
          12,
          2,
          12
        ],
        "uv": [
          16,
          40
        ],
        "name": "head",
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          6.933,
          -4.433,
          -1
        ],
        "size": [
          2,
          9,
          2
        ],
        "uv": [
          0,
          0
        ],
        "name": "spike10",
        "poseParent": "head",
        "pivot": [
          7.933,
          0.067,
          0
        ],
        "rotation": [
          0,
          0,
          135
        ]
      },
      {
        "origin": [
          -9,
          -4.5,
          -1
        ],
        "size": [
          2,
          9,
          2
        ],
        "uv": [
          0,
          0
        ],
        "name": "spike11",
        "poseParent": "head",
        "pivot": [
          -8,
          0,
          0
        ],
        "rotation": [
          0,
          0,
          225
        ]
      },
      {
        "origin": [
          7.077,
          3.5,
          7.077
        ],
        "size": [
          2,
          9,
          2
        ],
        "uv": [
          0,
          0
        ],
        "name": "spike6",
        "poseParent": "head",
        "pivot": [
          8.077,
          8,
          8.077
        ],
        "rotation": [
          -90,
          -225,
          0
        ]
      },
      {
        "origin": [
          -9.06,
          3.5,
          7.06
        ],
        "size": [
          2,
          9,
          2
        ],
        "uv": [
          0,
          0
        ],
        "name": "spike7",
        "poseParent": "head",
        "pivot": [
          -8.06,
          8,
          8.06
        ],
        "rotation": [
          -90,
          -135,
          0
        ]
      },
      {
        "origin": [
          -1,
          -4.488,
          6.988
        ],
        "size": [
          2,
          9,
          2
        ],
        "uv": [
          0,
          0
        ],
        "name": "spike8",
        "poseParent": "head",
        "pivot": [
          0,
          0.012,
          7.988
        ],
        "rotation": [
          -225,
          0,
          0
        ]
      },
      {
        "origin": [
          -1,
          -4.427,
          -8.927
        ],
        "size": [
          2,
          9,
          2
        ],
        "uv": [
          0,
          0
        ],
        "name": "spike9",
        "poseParent": "head",
        "pivot": [
          0,
          0.073,
          -7.927
        ],
        "rotation": [
          -135,
          0,
          0
        ]
      },
      {
        "origin": [
          -1,
          7,
          -8.25
        ],
        "size": [
          2,
          2,
          1
        ],
        "uv": [
          8,
          0
        ],
        "name": "eye",
        "poseParent": "head",
        "pivot": [
          0,
          24,
          -8.25
        ]
      },
      {
        "origin": [
          -2,
          6,
          7
        ],
        "size": [
          4,
          4,
          8
        ],
        "uv": [
          40,
          0
        ],
        "name": "tail0",
        "poseParent": "head",
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          -1.5,
          6.5,
          14
        ],
        "size": [
          3,
          3,
          7
        ],
        "uv": [
          0,
          54
        ],
        "name": "tail1",
        "poseParent": "tail0",
        "pivot": [
          -1.5,
          23.5,
          14
        ]
      },
      {
        "origin": [
          -1,
          7,
          20
        ],
        "size": [
          2,
          2,
          6
        ],
        "uv": [
          41,
          32
        ],
        "name": "tail2",
        "poseParent": "tail1",
        "pivot": [
          -1,
          23,
          20
        ]
      },
      {
        "origin": [
          0,
          3.5,
          23
        ],
        "size": [
          1,
          9,
          9
        ],
        "uv": [
          25,
          19
        ],
        "name": "tail2",
        "poseParent": "tail1",
        "pivot": [
          -1,
          23,
          20
        ]
      },
      {
        "origin": [
          -1,
          11.58,
          7.08
        ],
        "size": [
          2,
          9,
          2
        ],
        "uv": [
          0,
          0
        ],
        "name": "spike0",
        "poseParent": "head",
        "pivot": [
          0,
          16.08,
          8.08
        ],
        "rotation": [
          -315,
          0,
          0
        ]
      },
      {
        "origin": [
          -1,
          11.543,
          -9.043
        ],
        "size": [
          2,
          9,
          2
        ],
        "uv": [
          0,
          0
        ],
        "name": "spike1",
        "poseParent": "head",
        "pivot": [
          0,
          16.043,
          -8.043
        ],
        "rotation": [
          -45,
          0,
          0
        ]
      },
      {
        "origin": [
          6.967,
          11.467,
          -1
        ],
        "size": [
          2,
          9,
          2
        ],
        "uv": [
          0,
          0
        ],
        "name": "spike2",
        "poseParent": "head",
        "pivot": [
          7.967,
          15.967,
          0
        ],
        "rotation": [
          0,
          0,
          45
        ]
      },
      {
        "origin": [
          -8.921,
          11.421,
          -1
        ],
        "size": [
          2,
          9,
          2
        ],
        "uv": [
          0,
          0
        ],
        "name": "spike3",
        "poseParent": "head",
        "pivot": [
          -7.921,
          15.921,
          0
        ],
        "rotation": [
          0,
          0,
          315
        ]
      },
      {
        "origin": [
          -8.948,
          3.5,
          -8.948
        ],
        "size": [
          2,
          9,
          2
        ],
        "uv": [
          0,
          0
        ],
        "name": "spike4",
        "poseParent": "head",
        "pivot": [
          -7.948,
          8,
          -7.948
        ],
        "rotation": [
          -90,
          -45,
          0
        ]
      },
      {
        "origin": [
          7.023,
          3.5,
          -9.023
        ],
        "size": [
          2,
          9,
          2
        ],
        "uv": [
          0,
          0
        ],
        "name": "spike5",
        "poseParent": "head",
        "pivot": [
          8.023,
          8,
          -8.023
        ],
        "rotation": [
          -90,
          -315,
          0
        ]
      }
    ]
  },
  "phantom": {
    "id": "phantom",
    "textureSize": [
      64,
      64
    ],
    "cubes": [
      {
        "origin": [
          -3,
          23,
          -8
        ],
        "size": [
          5,
          3,
          9
        ],
        "uv": [
          0,
          8
        ],
        "name": "body",
        "pivot": [
          0,
          24,
          0
        ],
        "rotation": [
          5.73,
          0,
          0
        ]
      },
      {
        "origin": [
          -4,
          22,
          -12
        ],
        "size": [
          7,
          3,
          5
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "poseParent": "body",
        "pivot": [
          0,
          23,
          -7
        ],
        "rotation": [
          -11.459,
          0,
          0
        ],
        "parents": [
          {
            "pivot": [
              0,
              24,
              0
            ],
            "rotation": [
              5.73,
              0,
              0
            ]
          }
        ]
      },
      {
        "origin": [
          -9,
          24,
          -8
        ],
        "size": [
          6,
          2,
          9
        ],
        "uv": [
          23,
          12
        ],
        "name": "right_wing_base",
        "poseParent": "body",
        "mirror": true,
        "pivot": [
          -3,
          26,
          -8
        ],
        "rotation": [
          0,
          0,
          -5.73
        ],
        "parents": [
          {
            "pivot": [
              0,
              24,
              0
            ],
            "rotation": [
              5.73,
              0,
              0
            ]
          }
        ]
      },
      {
        "origin": [
          -22,
          25,
          -8
        ],
        "size": [
          13,
          1,
          9
        ],
        "uv": [
          16,
          24
        ],
        "name": "right_wing_tip",
        "poseParent": "right_wing_base",
        "mirror": true,
        "pivot": [
          -9,
          26,
          -8
        ],
        "rotation": [
          0,
          0,
          -5.73
        ],
        "parents": [
          {
            "pivot": [
              0,
              24,
              0
            ],
            "rotation": [
              5.73,
              0,
              0
            ]
          },
          {
            "pivot": [
              -3,
              26,
              -8
            ],
            "rotation": [
              0,
              0,
              -5.73
            ]
          }
        ]
      },
      {
        "origin": [
          -2,
          24,
          1
        ],
        "size": [
          3,
          2,
          6
        ],
        "uv": [
          3,
          20
        ],
        "name": "tail_base",
        "poseParent": "body",
        "pivot": [
          0,
          26,
          1
        ],
        "parents": [
          {
            "pivot": [
              0,
              24,
              0
            ],
            "rotation": [
              5.73,
              0,
              0
            ]
          }
        ]
      },
      {
        "origin": [
          -1,
          24.5,
          7
        ],
        "size": [
          1,
          1,
          6
        ],
        "uv": [
          4,
          29
        ],
        "name": "tail_tip",
        "poseParent": "tail_base",
        "pivot": [
          0,
          25.5,
          7
        ],
        "parents": [
          {
            "pivot": [
              0,
              24,
              0
            ],
            "rotation": [
              5.73,
              0,
              0
            ]
          }
        ]
      },
      {
        "origin": [
          2,
          24,
          -8
        ],
        "size": [
          6,
          2,
          9
        ],
        "uv": [
          23,
          12
        ],
        "name": "left_wing_base",
        "poseParent": "body",
        "pivot": [
          2,
          26,
          -8
        ],
        "rotation": [
          0,
          0,
          5.73
        ],
        "parents": [
          {
            "pivot": [
              0,
              24,
              0
            ],
            "rotation": [
              5.73,
              0,
              0
            ]
          }
        ]
      },
      {
        "origin": [
          8,
          25,
          -8
        ],
        "size": [
          13,
          1,
          9
        ],
        "uv": [
          16,
          24
        ],
        "name": "left_wing_tip",
        "poseParent": "left_wing_base",
        "pivot": [
          8,
          26,
          -8
        ],
        "rotation": [
          0,
          0,
          5.73
        ],
        "parents": [
          {
            "pivot": [
              0,
              24,
              0
            ],
            "rotation": [
              5.73,
              0,
              0
            ]
          },
          {
            "pivot": [
              2,
              26,
              -8
            ],
            "rotation": [
              0,
              0,
              5.73
            ]
          }
        ]
      }
    ]
  },
  "vex": {
    "id": "vex",
    "textureSize": [
      32,
      32
    ],
    "cubes": [
      {
        "origin": [
          -1.5,
          2,
          -1
        ],
        "size": [
          3,
          4,
          2
        ],
        "uv": [
          0,
          10
        ],
        "name": "body",
        "pivot": [
          0,
          2,
          0
        ]
      },
      {
        "origin": [
          -1.5,
          0,
          -1
        ],
        "size": [
          3,
          5,
          2
        ],
        "uv": [
          0,
          16
        ],
        "name": "body",
        "inflate": -0.2,
        "pivot": [
          0,
          2,
          0
        ]
      },
      {
        "origin": [
          -2.5,
          6,
          -2.5
        ],
        "size": [
          5,
          5,
          5
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "poseParent": "body",
        "pivot": [
          0,
          6,
          0
        ]
      },
      {
        "origin": [
          -3,
          2.25,
          -1
        ],
        "size": [
          2,
          4,
          2
        ],
        "uv": [
          23,
          0
        ],
        "name": "right_arm",
        "poseParent": "body",
        "inflate": -0.1,
        "pivot": [
          -1.75,
          5.75,
          0
        ]
      },
      {
        "origin": [
          1,
          2.25,
          -1
        ],
        "size": [
          2,
          4,
          2
        ],
        "uv": [
          23,
          6
        ],
        "name": "left_arm",
        "poseParent": "body",
        "inflate": -0.1,
        "pivot": [
          1.75,
          5.75,
          0
        ]
      },
      {
        "origin": [
          0.5,
          0,
          1
        ],
        "size": [
          8,
          5,
          0
        ],
        "uv": [
          16,
          22
        ],
        "name": "left_wing",
        "poseParent": "body",
        "mirror": true,
        "pivot": [
          0.5,
          5,
          1
        ]
      },
      {
        "origin": [
          -8.5,
          0,
          1
        ],
        "size": [
          8,
          5,
          0
        ],
        "uv": [
          16,
          22
        ],
        "name": "right_wing",
        "poseParent": "body",
        "pivot": [
          -0.5,
          5,
          1
        ]
      }
    ]
  },
  "ravager": {
    "id": "ravager",
    "textureSize": [
      128,
      128
    ],
    "cubes": [
      {
        "origin": [
          -12,
          0,
          -9
        ],
        "size": [
          8,
          37,
          8
        ],
        "uv": [
          64,
          0
        ],
        "name": "right_front_leg",
        "pivot": [
          -8,
          37,
          -5
        ]
      },
      {
        "origin": [
          -12,
          0,
          14
        ],
        "size": [
          8,
          37,
          8
        ],
        "uv": [
          96,
          0
        ],
        "name": "right_hind_leg",
        "pivot": [
          -8,
          37,
          18
        ]
      },
      {
        "origin": [
          4,
          0,
          14
        ],
        "size": [
          8,
          37,
          8
        ],
        "uv": [
          96,
          0
        ],
        "name": "left_hind_leg",
        "mirror": true,
        "pivot": [
          8,
          37,
          18
        ]
      },
      {
        "origin": [
          -5,
          22,
          -12.5
        ],
        "size": [
          10,
          10,
          18
        ],
        "uv": [
          68,
          73
        ],
        "name": "neck",
        "pivot": [
          0,
          31,
          5.5
        ]
      },
      {
        "origin": [
          -8,
          15,
          -25.5
        ],
        "size": [
          16,
          20,
          16
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "poseParent": "neck",
        "pivot": [
          0,
          15,
          -11.5
        ]
      },
      {
        "origin": [
          -2,
          13,
          -29.5
        ],
        "size": [
          4,
          8,
          4
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "poseParent": "neck",
        "pivot": [
          0,
          15,
          -11.5
        ]
      },
      {
        "origin": [
          -10,
          29,
          -21.5
        ],
        "size": [
          2,
          14,
          4
        ],
        "uv": [
          74,
          55
        ],
        "name": "right_horn",
        "poseParent": "head",
        "pivot": [
          -10,
          29,
          -19.5
        ],
        "rotation": [
          -63,
          0,
          0
        ]
      },
      {
        "origin": [
          -8,
          14,
          -25.5
        ],
        "size": [
          16,
          3,
          16
        ],
        "uv": [
          0,
          36
        ],
        "name": "mouth",
        "poseParent": "head",
        "pivot": [
          0,
          17,
          -9.5
        ]
      },
      {
        "origin": [
          8,
          29,
          -21.5
        ],
        "size": [
          2,
          14,
          4
        ],
        "uv": [
          74,
          55
        ],
        "name": "left_horn",
        "poseParent": "head",
        "mirror": true,
        "pivot": [
          8,
          29,
          -19.5
        ],
        "rotation": [
          -63,
          0,
          0
        ]
      },
      {
        "origin": [
          -7,
          17,
          -5
        ],
        "size": [
          14,
          16,
          20
        ],
        "uv": [
          0,
          55
        ],
        "name": "body",
        "pivot": [
          0,
          23,
          2
        ],
        "rotation": [
          -90,
          0,
          0
        ]
      },
      {
        "origin": [
          -6,
          4,
          -5
        ],
        "size": [
          12,
          13,
          18
        ],
        "uv": [
          0,
          91
        ],
        "name": "body",
        "pivot": [
          0,
          23,
          2
        ],
        "rotation": [
          -90,
          0,
          0
        ]
      },
      {
        "origin": [
          4,
          0,
          -9
        ],
        "size": [
          8,
          37,
          8
        ],
        "uv": [
          64,
          0
        ],
        "name": "left_front_leg",
        "mirror": true,
        "pivot": [
          8,
          37,
          -5
        ]
      }
    ]
  },
  "bat": {
    "id": "bat",
    "textureSize": [
      64,
      64
    ],
    "cubes": [
      {
        "origin": [
          -3,
          21,
          -3
        ],
        "size": [
          6,
          6,
          6
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          -4,
          26,
          -2
        ],
        "size": [
          3,
          4,
          1
        ],
        "uv": [
          24,
          0
        ],
        "name": "right_ear",
        "poseParent": "head",
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          1,
          26,
          -2
        ],
        "size": [
          3,
          4,
          1
        ],
        "uv": [
          24,
          0
        ],
        "name": "left_ear",
        "poseParent": "head",
        "mirror": true,
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          -3,
          8,
          -3
        ],
        "size": [
          6,
          12,
          6
        ],
        "uv": [
          0,
          16
        ],
        "name": "body",
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          -5,
          2,
          0
        ],
        "size": [
          10,
          6,
          1
        ],
        "uv": [
          0,
          34
        ],
        "name": "body",
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          -12,
          7,
          1.5
        ],
        "size": [
          10,
          16,
          1
        ],
        "uv": [
          42,
          0
        ],
        "name": "right_wing",
        "poseParent": "body",
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          -20,
          10,
          1.5
        ],
        "size": [
          8,
          12,
          1
        ],
        "uv": [
          24,
          16
        ],
        "name": "right_wing_tip",
        "poseParent": "right_wing",
        "pivot": [
          -12,
          23,
          1.5
        ]
      },
      {
        "origin": [
          2,
          7,
          1.5
        ],
        "size": [
          10,
          16,
          1
        ],
        "uv": [
          42,
          0
        ],
        "name": "left_wing",
        "poseParent": "body",
        "mirror": true,
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          12,
          10,
          1.5
        ],
        "size": [
          8,
          12,
          1
        ],
        "uv": [
          24,
          16
        ],
        "name": "left_wing_tip",
        "poseParent": "left_wing",
        "mirror": true,
        "pivot": [
          12,
          23,
          1.5
        ]
      }
    ]
  },
  "squid": {
    "id": "squid",
    "textureSize": [
      64,
      32
    ],
    "cubes": [
      {
        "origin": [
          4,
          -9,
          -1
        ],
        "size": [
          2,
          18,
          2
        ],
        "uv": [
          48,
          0
        ],
        "name": "tentacle0",
        "pivot": [
          5,
          9,
          0
        ],
        "rotation": [
          0,
          -90,
          0
        ]
      },
      {
        "origin": [
          2.536,
          -9,
          2.536
        ],
        "size": [
          2,
          18,
          2
        ],
        "uv": [
          48,
          0
        ],
        "name": "tentacle1",
        "pivot": [
          3.536,
          9,
          3.536
        ],
        "rotation": [
          0,
          -45,
          0
        ]
      },
      {
        "origin": [
          -1,
          -9,
          -6
        ],
        "size": [
          2,
          18,
          2
        ],
        "uv": [
          48,
          0
        ],
        "name": "tentacle6",
        "pivot": [
          0,
          9,
          -5
        ],
        "rotation": [
          0,
          180,
          0
        ]
      },
      {
        "origin": [
          2.536,
          -9,
          -4.536
        ],
        "size": [
          2,
          18,
          2
        ],
        "uv": [
          48,
          0
        ],
        "name": "tentacle7",
        "pivot": [
          3.536,
          9,
          -3.536
        ],
        "rotation": [
          0,
          225,
          0
        ]
      },
      {
        "origin": [
          -6,
          8,
          -6
        ],
        "size": [
          12,
          16,
          12
        ],
        "uv": [
          0,
          0
        ],
        "name": "body",
        "pivot": [
          0,
          16,
          0
        ]
      },
      {
        "origin": [
          -6,
          -9,
          -1
        ],
        "size": [
          2,
          18,
          2
        ],
        "uv": [
          48,
          0
        ],
        "name": "tentacle4",
        "pivot": [
          -5,
          9,
          0
        ],
        "rotation": [
          0,
          90,
          0
        ]
      },
      {
        "origin": [
          -4.536,
          -9,
          -4.536
        ],
        "size": [
          2,
          18,
          2
        ],
        "uv": [
          48,
          0
        ],
        "name": "tentacle5",
        "pivot": [
          -3.536,
          9,
          -3.536
        ],
        "rotation": [
          0,
          135,
          0
        ]
      },
      {
        "origin": [
          -1,
          -9,
          4
        ],
        "size": [
          2,
          18,
          2
        ],
        "uv": [
          48,
          0
        ],
        "name": "tentacle2",
        "pivot": [
          0,
          9,
          5
        ]
      },
      {
        "origin": [
          -4.536,
          -9,
          2.536
        ],
        "size": [
          2,
          18,
          2
        ],
        "uv": [
          48,
          0
        ],
        "name": "tentacle3",
        "pivot": [
          -3.536,
          9,
          3.536
        ],
        "rotation": [
          0,
          45,
          0
        ]
      }
    ]
  },
  "wither": {
    "id": "wither",
    "textureSize": [
      64,
      64
    ],
    "cubes": [
      {
        "origin": [
          -10,
          17.1,
          -0.5
        ],
        "size": [
          20,
          3,
          3
        ],
        "uv": [
          0,
          16
        ],
        "name": "shoulders",
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          -2,
          7.1,
          -0.5
        ],
        "size": [
          3,
          10,
          3
        ],
        "uv": [
          0,
          22
        ],
        "name": "ribcage",
        "pivot": [
          -2,
          17.1,
          -0.5
        ],
        "rotation": [
          -11.7,
          0,
          0
        ]
      },
      {
        "origin": [
          -6,
          13.6,
          0
        ],
        "size": [
          11,
          2,
          2
        ],
        "uv": [
          24,
          22
        ],
        "name": "ribcage",
        "pivot": [
          -2,
          17.1,
          -0.5
        ],
        "rotation": [
          -11.7,
          0,
          0
        ]
      },
      {
        "origin": [
          -6,
          11.1,
          0
        ],
        "size": [
          11,
          2,
          2
        ],
        "uv": [
          24,
          22
        ],
        "name": "ribcage",
        "pivot": [
          -2,
          17.1,
          -0.5
        ],
        "rotation": [
          -11.7,
          0,
          0
        ]
      },
      {
        "origin": [
          -6,
          8.6,
          0
        ],
        "size": [
          11,
          2,
          2
        ],
        "uv": [
          24,
          22
        ],
        "name": "ribcage",
        "pivot": [
          -2,
          17.1,
          -0.5
        ],
        "rotation": [
          -11.7,
          0,
          0
        ]
      },
      {
        "origin": [
          -2,
          1.308,
          1.527
        ],
        "size": [
          3,
          6,
          3
        ],
        "uv": [
          12,
          22
        ],
        "name": "tail",
        "pivot": [
          -2,
          7.308,
          1.527
        ],
        "rotation": [
          -47.7,
          0,
          0
        ]
      },
      {
        "origin": [
          6,
          18,
          -4
        ],
        "size": [
          6,
          6,
          6
        ],
        "uv": [
          32,
          0
        ],
        "name": "left_head",
        "pivot": [
          10,
          20,
          0
        ]
      },
      {
        "origin": [
          -12,
          18,
          -4
        ],
        "size": [
          6,
          6,
          6
        ],
        "uv": [
          32,
          0
        ],
        "name": "right_head",
        "pivot": [
          -8,
          20,
          0
        ]
      },
      {
        "origin": [
          -4,
          20,
          -4
        ],
        "size": [
          8,
          8,
          8
        ],
        "uv": [
          0,
          0
        ],
        "name": "center_head",
        "pivot": [
          0,
          24,
          0
        ]
      }
    ]
  },
  "polar_bear": {
    "id": "polar_bear",
    "textureSize": [
      128,
      64
    ],
    "cubes": [
      {
        "origin": [
          -3.5,
          10,
          -19
        ],
        "size": [
          7,
          7,
          7
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "pivot": [
          0,
          14,
          -16
        ]
      },
      {
        "origin": [
          -2.5,
          10,
          -22
        ],
        "size": [
          5,
          3,
          3
        ],
        "uv": [
          0,
          44
        ],
        "name": "head",
        "pivot": [
          0,
          14,
          -16
        ]
      },
      {
        "origin": [
          -4.5,
          16,
          -17
        ],
        "size": [
          2,
          2,
          1
        ],
        "uv": [
          26,
          0
        ],
        "name": "head",
        "pivot": [
          0,
          14,
          -16
        ]
      },
      {
        "origin": [
          2.5,
          16,
          -17
        ],
        "size": [
          2,
          2,
          1
        ],
        "uv": [
          26,
          0
        ],
        "name": "head",
        "mirror": true,
        "pivot": [
          0,
          14,
          -16
        ]
      },
      {
        "origin": [
          -5.5,
          0,
          -10
        ],
        "size": [
          4,
          10,
          6
        ],
        "uv": [
          50,
          40
        ],
        "name": "right_front_leg",
        "pivot": [
          -3.5,
          10,
          -8
        ]
      },
      {
        "origin": [
          -6.5,
          0,
          4
        ],
        "size": [
          4,
          10,
          8
        ],
        "uv": [
          50,
          22
        ],
        "name": "right_hind_leg",
        "pivot": [
          -4.5,
          10,
          6
        ]
      },
      {
        "origin": [
          2.5,
          0,
          4
        ],
        "size": [
          4,
          10,
          8
        ],
        "uv": [
          50,
          22
        ],
        "name": "left_hind_leg",
        "pivot": [
          4.5,
          10,
          6
        ]
      },
      {
        "origin": [
          -7,
          14,
          5
        ],
        "size": [
          14,
          14,
          11
        ],
        "uv": [
          0,
          19
        ],
        "name": "body",
        "pivot": [
          -2,
          15,
          12
        ],
        "rotation": [
          -90,
          0,
          0
        ]
      },
      {
        "origin": [
          -6,
          28,
          5
        ],
        "size": [
          12,
          12,
          10
        ],
        "uv": [
          39,
          0
        ],
        "name": "body",
        "pivot": [
          -2,
          15,
          12
        ],
        "rotation": [
          -90,
          0,
          0
        ]
      },
      {
        "origin": [
          1.5,
          0,
          -10
        ],
        "size": [
          4,
          10,
          6
        ],
        "uv": [
          50,
          40
        ],
        "name": "left_front_leg",
        "pivot": [
          3.5,
          10,
          -8
        ]
      }
    ]
  },
  "llama": {
    "id": "llama",
    "textureSize": [
      128,
      64
    ],
    "cubes": [
      {
        "origin": [
          -2,
          27,
          -16
        ],
        "size": [
          4,
          4,
          9
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "pivot": [
          0,
          17,
          -6
        ]
      },
      {
        "origin": [
          -4,
          15,
          -12
        ],
        "size": [
          8,
          18,
          6
        ],
        "uv": [
          0,
          14
        ],
        "name": "head",
        "pivot": [
          0,
          17,
          -6
        ]
      },
      {
        "origin": [
          -4,
          33,
          -10
        ],
        "size": [
          3,
          3,
          2
        ],
        "uv": [
          17,
          0
        ],
        "name": "head",
        "pivot": [
          0,
          17,
          -6
        ]
      },
      {
        "origin": [
          1,
          33,
          -10
        ],
        "size": [
          3,
          3,
          2
        ],
        "uv": [
          17,
          0
        ],
        "name": "head",
        "pivot": [
          0,
          17,
          -6
        ]
      },
      {
        "origin": [
          -5.5,
          0,
          -7
        ],
        "size": [
          4,
          14,
          4
        ],
        "uv": [
          29,
          29
        ],
        "name": "right_front_leg",
        "pivot": [
          -3.5,
          14,
          -5
        ]
      },
      {
        "origin": [
          -5.5,
          0,
          4
        ],
        "size": [
          4,
          14,
          4
        ],
        "uv": [
          29,
          29
        ],
        "name": "right_hind_leg",
        "pivot": [
          -3.5,
          14,
          6
        ]
      },
      {
        "origin": [
          -11.5,
          13,
          3
        ],
        "size": [
          8,
          8,
          3
        ],
        "uv": [
          45,
          28
        ],
        "name": "right_chest",
        "pivot": [
          -8.5,
          21,
          3
        ],
        "rotation": [
          0,
          -90,
          0
        ]
      },
      {
        "origin": [
          1.5,
          0,
          4
        ],
        "size": [
          4,
          14,
          4
        ],
        "uv": [
          29,
          29
        ],
        "name": "left_hind_leg",
        "pivot": [
          3.5,
          14,
          6
        ]
      },
      {
        "origin": [
          -6,
          11,
          -5
        ],
        "size": [
          12,
          18,
          10
        ],
        "uv": [
          29,
          0
        ],
        "name": "body",
        "pivot": [
          0,
          19,
          2
        ],
        "rotation": [
          -90,
          0,
          0
        ]
      },
      {
        "origin": [
          1.5,
          0,
          -7
        ],
        "size": [
          4,
          14,
          4
        ],
        "uv": [
          29,
          29
        ],
        "name": "left_front_leg",
        "pivot": [
          3.5,
          14,
          -5
        ]
      },
      {
        "origin": [
          2.5,
          13,
          3
        ],
        "size": [
          8,
          8,
          3
        ],
        "uv": [
          45,
          41
        ],
        "name": "left_chest",
        "pivot": [
          5.5,
          21,
          3
        ],
        "rotation": [
          0,
          -90,
          0
        ]
      }
    ]
  },
  "horse": {
    "id": "horse",
    "textureSize": [
      64,
      64
    ],
    "cubes": [
      {
        "origin": [
          -5,
          0.01,
          -13.9
        ],
        "size": [
          4,
          11,
          4
        ],
        "uv": [
          48,
          21
        ],
        "name": "right_front_leg",
        "pivot": [
          -4,
          10,
          -12
        ]
      },
      {
        "origin": [
          -5,
          0.01,
          6
        ],
        "size": [
          4,
          11,
          4
        ],
        "uv": [
          48,
          21
        ],
        "name": "right_hind_leg",
        "pivot": [
          -4,
          10,
          7
        ]
      },
      {
        "origin": [
          -2.05,
          14,
          -14
        ],
        "size": [
          4,
          12,
          7
        ],
        "uv": [
          0,
          35
        ],
        "name": "head_parts",
        "pivot": [
          0,
          20,
          -12
        ],
        "rotation": [
          -30,
          0,
          0
        ]
      },
      {
        "origin": [
          -3,
          26,
          -14
        ],
        "size": [
          6,
          5,
          7
        ],
        "uv": [
          0,
          13
        ],
        "name": "head",
        "poseParent": "head_parts",
        "pivot": [
          0,
          20,
          -12
        ],
        "parents": [
          {
            "pivot": [
              0,
              20,
              -12
            ],
            "rotation": [
              -30,
              0,
              0
            ]
          }
        ]
      },
      {
        "origin": [
          -2.55,
          30,
          -8
        ],
        "size": [
          2,
          3,
          1
        ],
        "uv": [
          19,
          16
        ],
        "name": "right_ear",
        "poseParent": "head",
        "pivot": [
          0,
          20,
          -12
        ],
        "parents": [
          {
            "pivot": [
              0,
              20,
              -12
            ],
            "rotation": [
              -30,
              0,
              0
            ]
          }
        ]
      },
      {
        "origin": [
          0.55,
          30,
          -8
        ],
        "size": [
          2,
          3,
          1
        ],
        "uv": [
          19,
          16
        ],
        "name": "left_ear",
        "poseParent": "head",
        "pivot": [
          0,
          20,
          -12
        ],
        "parents": [
          {
            "pivot": [
              0,
              20,
              -12
            ],
            "rotation": [
              -30,
              0,
              0
            ]
          }
        ]
      },
      {
        "origin": [
          2,
          27,
          -18
        ],
        "size": [
          1,
          2,
          2
        ],
        "uv": [
          29,
          5
        ],
        "name": "left_saddle_mouth",
        "poseParent": "head_parts",
        "pivot": [
          0,
          20,
          -12
        ],
        "parents": [
          {
            "pivot": [
              0,
              20,
              -12
            ],
            "rotation": [
              -30,
              0,
              0
            ]
          }
        ]
      },
      {
        "origin": [
          -2,
          26,
          -16
        ],
        "size": [
          4,
          5,
          2
        ],
        "uv": [
          19,
          0
        ],
        "name": "mouth_saddle_wrap",
        "poseParent": "head_parts",
        "inflate": 0.2,
        "pivot": [
          0,
          20,
          -12
        ],
        "parents": [
          {
            "pivot": [
              0,
              20,
              -12
            ],
            "rotation": [
              -30,
              0,
              0
            ]
          }
        ]
      },
      {
        "origin": [
          -3.1,
          23,
          -20
        ],
        "size": [
          0,
          3,
          16
        ],
        "uv": [
          32,
          2
        ],
        "name": "right_saddle_line",
        "poseParent": "head_parts",
        "pivot": [
          0,
          20,
          -12
        ],
        "rotation": [
          30,
          0,
          0
        ],
        "parents": [
          {
            "pivot": [
              0,
              20,
              -12
            ],
            "rotation": [
              -30,
              0,
              0
            ]
          }
        ]
      },
      {
        "origin": [
          -1,
          15,
          -6.99
        ],
        "size": [
          2,
          16,
          2
        ],
        "uv": [
          56,
          36
        ],
        "name": "mane",
        "poseParent": "head_parts",
        "pivot": [
          0,
          20,
          -12
        ],
        "parents": [
          {
            "pivot": [
              0,
              20,
              -12
            ],
            "rotation": [
              -30,
              0,
              0
            ]
          }
        ]
      },
      {
        "origin": [
          -3,
          27,
          -18
        ],
        "size": [
          1,
          2,
          2
        ],
        "uv": [
          29,
          5
        ],
        "name": "right_saddle_mouth",
        "poseParent": "head_parts",
        "pivot": [
          0,
          20,
          -12
        ],
        "parents": [
          {
            "pivot": [
              0,
              20,
              -12
            ],
            "rotation": [
              -30,
              0,
              0
            ]
          }
        ]
      },
      {
        "origin": [
          3.1,
          23,
          -20
        ],
        "size": [
          0,
          3,
          16
        ],
        "uv": [
          32,
          2
        ],
        "name": "left_saddle_line",
        "poseParent": "head_parts",
        "pivot": [
          0,
          20,
          -12
        ],
        "rotation": [
          30,
          0,
          0
        ],
        "parents": [
          {
            "pivot": [
              0,
              20,
              -12
            ],
            "rotation": [
              -30,
              0,
              0
            ]
          }
        ]
      },
      {
        "origin": [
          -2,
          26,
          -19
        ],
        "size": [
          4,
          5,
          5
        ],
        "uv": [
          0,
          25
        ],
        "name": "upper_mouth",
        "poseParent": "head_parts",
        "pivot": [
          0,
          20,
          -12
        ],
        "parents": [
          {
            "pivot": [
              0,
              20,
              -12
            ],
            "rotation": [
              -30,
              0,
              0
            ]
          }
        ]
      },
      {
        "origin": [
          -3,
          26,
          -13.9
        ],
        "size": [
          6,
          5,
          6
        ],
        "uv": [
          1,
          1
        ],
        "name": "head_saddle",
        "poseParent": "head_parts",
        "inflate": 0.2,
        "pivot": [
          0,
          20,
          -12
        ],
        "parents": [
          {
            "pivot": [
              0,
              20,
              -12
            ],
            "rotation": [
              -30,
              0,
              0
            ]
          }
        ]
      },
      {
        "origin": [
          1,
          0.01,
          6
        ],
        "size": [
          4,
          11,
          4
        ],
        "uv": [
          48,
          21
        ],
        "name": "left_hind_leg",
        "mirror": true,
        "pivot": [
          4,
          10,
          7
        ]
      },
      {
        "origin": [
          -5,
          11,
          -12
        ],
        "size": [
          10,
          10,
          22
        ],
        "uv": [
          0,
          32
        ],
        "name": "body",
        "inflate": 0.05,
        "pivot": [
          0,
          13,
          5
        ]
      },
      {
        "origin": [
          -5,
          12,
          -4
        ],
        "size": [
          10,
          9,
          9
        ],
        "uv": [
          26,
          0
        ],
        "name": "saddle",
        "poseParent": "body",
        "inflate": 0.5,
        "pivot": [
          0,
          13,
          5
        ]
      },
      {
        "origin": [
          -1.5,
          4,
          7
        ],
        "size": [
          3,
          14,
          4
        ],
        "uv": [
          42,
          36
        ],
        "name": "tail",
        "poseParent": "body",
        "pivot": [
          0,
          18,
          7
        ],
        "rotation": [
          -30,
          0,
          0
        ]
      },
      {
        "origin": [
          1,
          0.01,
          -13.9
        ],
        "size": [
          4,
          11,
          4
        ],
        "uv": [
          48,
          21
        ],
        "name": "left_front_leg",
        "mirror": true,
        "pivot": [
          4,
          10,
          -12
        ]
      }
    ]
  },
  "donkey": {
    "id": "donkey",
    "textureSize": [
      64,
      64
    ],
    "cubes": [
      {
        "origin": [
          -5,
          11,
          -11
        ],
        "size": [
          10,
          10,
          22
        ],
        "uv": [
          0,
          32
        ],
        "name": "body",
        "pivot": [
          0,
          13,
          9
        ]
      },
      {
        "origin": [
          -1.5,
          6,
          9
        ],
        "size": [
          3,
          14,
          4
        ],
        "uv": [
          42,
          36
        ],
        "name": "tail",
        "poseParent": "body",
        "pivot": [
          0,
          20,
          11
        ],
        "rotation": [
          -25,
          0,
          0
        ]
      },
      {
        "origin": [
          1,
          0,
          7
        ],
        "size": [
          4,
          11,
          4
        ],
        "uv": [
          48,
          21
        ],
        "name": "leg_bl",
        "poseParent": "body",
        "mirror": true,
        "pivot": [
          3,
          11,
          9
        ]
      },
      {
        "origin": [
          -5,
          0,
          7
        ],
        "size": [
          4,
          11,
          4
        ],
        "uv": [
          48,
          21
        ],
        "name": "leg_br",
        "poseParent": "body",
        "pivot": [
          -3,
          11,
          9
        ]
      },
      {
        "origin": [
          1,
          0,
          -11
        ],
        "size": [
          4,
          11,
          4
        ],
        "uv": [
          48,
          21
        ],
        "name": "leg_fl",
        "poseParent": "body",
        "mirror": true,
        "pivot": [
          3,
          11,
          -9
        ]
      },
      {
        "origin": [
          -5,
          0,
          -11
        ],
        "size": [
          4,
          11,
          4
        ],
        "uv": [
          48,
          21
        ],
        "name": "leg_fr",
        "poseParent": "body",
        "pivot": [
          -3,
          11,
          -9
        ]
      },
      {
        "origin": [
          -2,
          16,
          -11
        ],
        "size": [
          4,
          12,
          7
        ],
        "uv": [
          0,
          35
        ],
        "name": "neck",
        "poseParent": "body",
        "pivot": [
          0,
          17,
          -8
        ],
        "rotation": [
          -30,
          0,
          0
        ]
      },
      {
        "origin": [
          -3,
          28,
          -11
        ],
        "size": [
          6,
          5,
          7
        ],
        "uv": [
          0,
          13
        ],
        "name": "head",
        "poseParent": "neck",
        "pivot": [
          0,
          28,
          -11
        ],
        "parents": [
          {
            "pivot": [
              0,
              17,
              -8
            ],
            "rotation": [
              -30,
              0,
              0
            ]
          }
        ]
      },
      {
        "origin": [
          -2,
          28,
          -16
        ],
        "size": [
          4,
          5,
          5
        ],
        "uv": [
          0,
          25
        ],
        "name": "muzzle",
        "poseParent": "head",
        "pivot": [
          0,
          28,
          -11
        ],
        "parents": [
          {
            "pivot": [
              0,
              17,
              -8
            ],
            "rotation": [
              -30,
              0,
              0
            ]
          }
        ]
      },
      {
        "origin": [
          -3,
          32,
          -5.01
        ],
        "size": [
          2,
          7,
          1
        ],
        "uv": [
          0,
          12
        ],
        "name": "mule_ear_l",
        "poseParent": "head",
        "mirror": true,
        "pivot": [
          0,
          17,
          -8
        ],
        "rotation": [
          0,
          0,
          -15
        ],
        "parents": [
          {
            "pivot": [
              0,
              17,
              -8
            ],
            "rotation": [
              -30,
              0,
              0
            ]
          }
        ]
      },
      {
        "origin": [
          1,
          32,
          -5.01
        ],
        "size": [
          2,
          7,
          1
        ],
        "uv": [
          0,
          12
        ],
        "name": "mule_ear_r",
        "poseParent": "head",
        "pivot": [
          0,
          17,
          -8
        ],
        "rotation": [
          0,
          0,
          15
        ],
        "parents": [
          {
            "pivot": [
              0,
              17,
              -8
            ],
            "rotation": [
              -30,
              0,
              0
            ]
          }
        ]
      },
      {
        "origin": [
          -1,
          17,
          -3.95
        ],
        "size": [
          2,
          16,
          2
        ],
        "uv": [
          56,
          36
        ],
        "name": "mane",
        "poseParent": "neck",
        "pivot": [
          0,
          17,
          -8
        ],
        "parents": [
          {
            "pivot": [
              0,
              17,
              -8
            ],
            "rotation": [
              -30,
              0,
              0
            ]
          }
        ]
      }
    ]
  },
  "rabbit": {
    "id": "rabbit",
    "textureSize": [
      64,
      32
    ],
    "cubes": [
      {
        "origin": [
          -2.5,
          8,
          -6
        ],
        "size": [
          5,
          4,
          5
        ],
        "uv": [
          32,
          0
        ],
        "name": "head",
        "pivot": [
          0,
          8,
          -1
        ]
      },
      {
        "origin": [
          -0.5,
          9.5,
          -6.5
        ],
        "size": [
          1,
          1,
          1
        ],
        "uv": [
          32,
          9
        ],
        "name": "nose",
        "pivot": [
          0,
          8,
          -1
        ]
      },
      {
        "origin": [
          -4,
          0,
          -2
        ],
        "size": [
          2,
          7,
          2
        ],
        "uv": [
          0,
          15
        ],
        "name": "right_front_leg",
        "pivot": [
          -3,
          7,
          -1
        ],
        "rotation": [
          10,
          0,
          0
        ]
      },
      {
        "origin": [
          -4,
          0,
          0
        ],
        "size": [
          2,
          1,
          7
        ],
        "uv": [
          8,
          24
        ],
        "name": "right_hind_foot",
        "pivot": [
          -3,
          6.5,
          3.7
        ]
      },
      {
        "origin": [
          -1.5,
          2.5,
          7
        ],
        "size": [
          3,
          3,
          2
        ],
        "uv": [
          52,
          6
        ],
        "name": "tail",
        "pivot": [
          0,
          4,
          7
        ],
        "rotation": [
          20,
          0,
          0
        ]
      },
      {
        "origin": [
          2,
          2.5,
          3.7
        ],
        "size": [
          2,
          4,
          5
        ],
        "uv": [
          30,
          15
        ],
        "name": "left_haunch",
        "pivot": [
          3,
          6.5,
          3.7
        ],
        "rotation": [
          20,
          0,
          0
        ]
      },
      {
        "origin": [
          -4,
          2.5,
          3.7
        ],
        "size": [
          2,
          4,
          5
        ],
        "uv": [
          16,
          15
        ],
        "name": "right_haunch",
        "pivot": [
          -3,
          6.5,
          3.7
        ],
        "rotation": [
          20,
          0,
          0
        ]
      },
      {
        "origin": [
          -3,
          2,
          -2
        ],
        "size": [
          6,
          5,
          10
        ],
        "uv": [
          0,
          0
        ],
        "name": "body",
        "pivot": [
          0,
          5,
          8
        ],
        "rotation": [
          20,
          0,
          0
        ]
      },
      {
        "origin": [
          -2.5,
          12,
          -2
        ],
        "size": [
          2,
          5,
          1
        ],
        "uv": [
          52,
          0
        ],
        "name": "right_ear",
        "pivot": [
          0,
          8,
          -1
        ],
        "rotation": [
          0,
          15,
          0
        ]
      },
      {
        "origin": [
          2,
          0,
          -2
        ],
        "size": [
          2,
          7,
          2
        ],
        "uv": [
          8,
          15
        ],
        "name": "left_front_leg",
        "pivot": [
          3,
          7,
          -1
        ],
        "rotation": [
          10,
          0,
          0
        ]
      },
      {
        "origin": [
          2,
          0,
          0
        ],
        "size": [
          2,
          1,
          7
        ],
        "uv": [
          26,
          24
        ],
        "name": "left_hind_foot",
        "pivot": [
          3,
          6.5,
          3.7
        ]
      },
      {
        "origin": [
          0.5,
          12,
          -2
        ],
        "size": [
          2,
          5,
          1
        ],
        "uv": [
          58,
          0
        ],
        "name": "left_ear",
        "pivot": [
          0,
          8,
          -1
        ],
        "rotation": [
          0,
          -15,
          0
        ]
      }
    ]
  },
  "parrot": {
    "id": "parrot",
    "textureSize": [
      32,
      32
    ],
    "cubes": [
      {
        "origin": [
          -1,
          6.81,
          -3.76
        ],
        "size": [
          2,
          3,
          2
        ],
        "uv": [
          2,
          2
        ],
        "name": "head",
        "pivot": [
          0,
          8.31,
          -2.76
        ]
      },
      {
        "origin": [
          -0.5,
          7.81,
          -4.76
        ],
        "size": [
          1,
          2,
          1
        ],
        "uv": [
          11,
          7
        ],
        "name": "beak1",
        "poseParent": "head",
        "pivot": [
          0,
          8.81,
          -4.26
        ]
      },
      {
        "origin": [
          -0.5,
          8.06,
          -5.71
        ],
        "size": [
          1,
          2,
          1
        ],
        "uv": [
          16,
          7
        ],
        "name": "beak2",
        "poseParent": "head",
        "pivot": [
          0,
          10.06,
          -5.21
        ]
      },
      {
        "origin": [
          0,
          9.46,
          -4.61
        ],
        "size": [
          0,
          5,
          4
        ],
        "uv": [
          2,
          18
        ],
        "name": "feather",
        "poseParent": "head",
        "pivot": [
          0,
          10.46,
          -2.61
        ]
      },
      {
        "origin": [
          -1,
          9.81,
          -5.76
        ],
        "size": [
          2,
          1,
          4
        ],
        "uv": [
          10,
          0
        ],
        "name": "head2",
        "poseParent": "head",
        "pivot": [
          0,
          10.31,
          -3.76
        ]
      },
      {
        "origin": [
          0.5,
          0,
          -1.55
        ],
        "size": [
          1,
          2,
          1
        ],
        "uv": [
          14,
          18
        ],
        "name": "left_leg",
        "pivot": [
          1,
          2,
          -1.05
        ]
      },
      {
        "origin": [
          -2,
          2.06,
          -4.26
        ],
        "size": [
          1,
          5,
          3
        ],
        "uv": [
          19,
          8
        ],
        "name": "right_wing",
        "pivot": [
          -1.5,
          7.06,
          -2.76
        ]
      },
      {
        "origin": [
          -1.5,
          0,
          -1.55
        ],
        "size": [
          1,
          2,
          1
        ],
        "uv": [
          14,
          18
        ],
        "name": "right_leg",
        "pivot": [
          -1,
          2,
          -1.05
        ]
      },
      {
        "origin": [
          -1.5,
          -0.07,
          0.16
        ],
        "size": [
          3,
          4,
          1
        ],
        "uv": [
          22,
          1
        ],
        "name": "tail",
        "pivot": [
          0,
          2.93,
          1.16
        ]
      },
      {
        "origin": [
          1,
          2.06,
          -4.26
        ],
        "size": [
          1,
          5,
          3
        ],
        "uv": [
          19,
          8
        ],
        "name": "left_wing",
        "pivot": [
          1.5,
          7.06,
          -2.76
        ]
      },
      {
        "origin": [
          -1.5,
          1.5,
          -4.5
        ],
        "size": [
          3,
          6,
          3
        ],
        "uv": [
          2,
          8
        ],
        "name": "body",
        "pivot": [
          0,
          7.5,
          -3
        ]
      }
    ]
  },
  "fox": {
    "id": "fox",
    "textureSize": [
      48,
      32
    ],
    "cubes": [
      {
        "origin": [
          -4,
          3.5,
          -8
        ],
        "size": [
          8,
          6,
          6
        ],
        "uv": [
          1,
          5
        ],
        "name": "head",
        "pivot": [
          -1,
          7.5,
          -3
        ]
      },
      {
        "origin": [
          -2,
          3.49,
          -11
        ],
        "size": [
          4,
          2,
          3
        ],
        "uv": [
          6,
          18
        ],
        "name": "nose",
        "poseParent": "head",
        "pivot": [
          -1,
          7.5,
          -3
        ]
      },
      {
        "origin": [
          -4,
          9.5,
          -7
        ],
        "size": [
          2,
          2,
          1
        ],
        "uv": [
          8,
          1
        ],
        "name": "right_ear",
        "poseParent": "head",
        "pivot": [
          -1,
          7.5,
          -3
        ]
      },
      {
        "origin": [
          2,
          9.5,
          -7
        ],
        "size": [
          2,
          2,
          1
        ],
        "uv": [
          15,
          1
        ],
        "name": "left_ear",
        "poseParent": "head",
        "pivot": [
          -1,
          7.5,
          -3
        ]
      },
      {
        "origin": [
          -3,
          0,
          -1
        ],
        "size": [
          2,
          6,
          2
        ],
        "uv": [
          13,
          24
        ],
        "name": "right_front_leg",
        "pivot": [
          -5,
          6.5,
          0
        ]
      },
      {
        "origin": [
          -3,
          0,
          6
        ],
        "size": [
          2,
          6,
          2
        ],
        "uv": [
          13,
          24
        ],
        "name": "right_hind_leg",
        "pivot": [
          -5,
          6.5,
          7
        ]
      },
      {
        "origin": [
          1,
          0,
          6
        ],
        "size": [
          2,
          6,
          2
        ],
        "uv": [
          4,
          24
        ],
        "name": "left_hind_leg",
        "pivot": [
          -1,
          6.5,
          7
        ]
      },
      {
        "origin": [
          -3,
          -6.999,
          -9.5
        ],
        "size": [
          6,
          11,
          6
        ],
        "uv": [
          24,
          15
        ],
        "name": "body",
        "pivot": [
          0,
          8,
          -6
        ],
        "rotation": [
          -90,
          0,
          0
        ]
      },
      {
        "origin": [
          -2,
          -16,
          -8
        ],
        "size": [
          4,
          9,
          5
        ],
        "uv": [
          30,
          0
        ],
        "name": "tail",
        "poseParent": "body",
        "pivot": [
          -4,
          -7,
          -7
        ],
        "rotation": [
          3,
          0,
          0
        ],
        "parents": [
          {
            "pivot": [
              0,
              8,
              -6
            ],
            "rotation": [
              -90,
              0,
              0
            ]
          }
        ]
      },
      {
        "origin": [
          1,
          0,
          -1
        ],
        "size": [
          2,
          6,
          2
        ],
        "uv": [
          4,
          24
        ],
        "name": "left_front_leg",
        "pivot": [
          -1,
          6.5,
          0
        ]
      }
    ]
  },
  "panda": {
    "id": "panda",
    "textureSize": [
      64,
      64
    ],
    "cubes": [
      {
        "origin": [
          -6.5,
          7.5,
          -21
        ],
        "size": [
          13,
          10,
          9
        ],
        "uv": [
          0,
          6
        ],
        "name": "head",
        "pivot": [
          0,
          12.5,
          -17
        ]
      },
      {
        "origin": [
          -3.5,
          7.5,
          -23
        ],
        "size": [
          7,
          5,
          2
        ],
        "uv": [
          45,
          16
        ],
        "name": "head",
        "pivot": [
          0,
          12.5,
          -17
        ]
      },
      {
        "origin": [
          3.5,
          16.5,
          -18
        ],
        "size": [
          5,
          4,
          1
        ],
        "uv": [
          52,
          25
        ],
        "name": "head",
        "pivot": [
          0,
          12.5,
          -17
        ]
      },
      {
        "origin": [
          -8.5,
          16.5,
          -18
        ],
        "size": [
          5,
          4,
          1
        ],
        "uv": [
          52,
          25
        ],
        "name": "head",
        "pivot": [
          0,
          12.5,
          -17
        ]
      },
      {
        "origin": [
          -8.5,
          0,
          -12
        ],
        "size": [
          6,
          9,
          6
        ],
        "uv": [
          40,
          0
        ],
        "name": "right_front_leg",
        "pivot": [
          -5.5,
          9,
          -9
        ]
      },
      {
        "origin": [
          -8.5,
          0,
          6
        ],
        "size": [
          6,
          9,
          6
        ],
        "uv": [
          40,
          0
        ],
        "name": "right_hind_leg",
        "pivot": [
          -5.5,
          9,
          9
        ]
      },
      {
        "origin": [
          2.5,
          0,
          6
        ],
        "size": [
          6,
          9,
          6
        ],
        "uv": [
          40,
          0
        ],
        "name": "left_hind_leg",
        "pivot": [
          5.5,
          9,
          9
        ]
      },
      {
        "origin": [
          -9.5,
          1,
          -6.5
        ],
        "size": [
          19,
          26,
          13
        ],
        "uv": [
          0,
          25
        ],
        "name": "body",
        "pivot": [
          0,
          14,
          0
        ],
        "rotation": [
          -90,
          0,
          0
        ]
      },
      {
        "origin": [
          2.5,
          0,
          -12
        ],
        "size": [
          6,
          9,
          6
        ],
        "uv": [
          40,
          0
        ],
        "name": "left_front_leg",
        "pivot": [
          5.5,
          9,
          -9
        ]
      }
    ]
  },
  "goat": {
    "id": "goat",
    "textureSize": [
      64,
      64
    ],
    "cubes": [
      {
        "origin": [
          -5,
          19,
          -10
        ],
        "size": [
          3,
          2,
          1
        ],
        "uv": [
          2,
          61
        ],
        "name": "head",
        "pivot": [
          1,
          10,
          0
        ]
      },
      {
        "origin": [
          3,
          19,
          -10
        ],
        "size": [
          3,
          2,
          1
        ],
        "uv": [
          2,
          61
        ],
        "name": "head",
        "mirror": true,
        "pivot": [
          1,
          10,
          0
        ]
      },
      {
        "origin": [
          0.5,
          6,
          -14
        ],
        "size": [
          0,
          7,
          5
        ],
        "uv": [
          23,
          52
        ],
        "name": "head",
        "mirror": true,
        "pivot": [
          1,
          10,
          0
        ]
      },
      {
        "origin": [
          -2,
          15,
          -16
        ],
        "size": [
          5,
          7,
          10
        ],
        "uv": [
          34,
          46
        ],
        "name": "nose",
        "poseParent": "head",
        "pivot": [
          1,
          18,
          -8
        ],
        "rotation": [
          -54.998,
          0,
          0
        ]
      },
      {
        "origin": [
          -1.99,
          19,
          -10
        ],
        "size": [
          2,
          7,
          2
        ],
        "uv": [
          12,
          55
        ],
        "name": "right_horn",
        "poseParent": "head",
        "pivot": [
          1,
          10,
          0
        ]
      },
      {
        "origin": [
          0.99,
          19,
          -10
        ],
        "size": [
          2,
          7,
          2
        ],
        "uv": [
          12,
          55
        ],
        "name": "left_horn",
        "poseParent": "head",
        "pivot": [
          1,
          10,
          0
        ]
      },
      {
        "origin": [
          -3,
          0,
          -6
        ],
        "size": [
          3,
          10,
          3
        ],
        "uv": [
          35,
          2
        ],
        "name": "right_front_leg",
        "pivot": [
          -3,
          10,
          -6
        ]
      },
      {
        "origin": [
          -3,
          0,
          4
        ],
        "size": [
          3,
          6,
          3
        ],
        "uv": [
          49,
          29
        ],
        "name": "right_hind_leg",
        "pivot": [
          -3,
          10,
          4
        ]
      },
      {
        "origin": [
          1,
          0,
          4
        ],
        "size": [
          3,
          6,
          3
        ],
        "uv": [
          36,
          29
        ],
        "name": "left_hind_leg",
        "pivot": [
          1,
          10,
          4
        ]
      },
      {
        "origin": [
          -4,
          6,
          -7
        ],
        "size": [
          9,
          11,
          16
        ],
        "uv": [
          1,
          1
        ],
        "name": "body",
        "pivot": [
          0,
          0,
          0
        ]
      },
      {
        "origin": [
          -5,
          4,
          -8
        ],
        "size": [
          11,
          14,
          11
        ],
        "uv": [
          0,
          28
        ],
        "name": "body",
        "pivot": [
          0,
          0,
          0
        ]
      },
      {
        "origin": [
          1,
          0,
          -6
        ],
        "size": [
          3,
          10,
          3
        ],
        "uv": [
          49,
          2
        ],
        "name": "left_front_leg",
        "pivot": [
          1,
          10,
          -6
        ]
      }
    ]
  },
  "turtle": {
    "id": "turtle",
    "textureSize": [
      128,
      64
    ],
    "cubes": [
      {
        "origin": [
          -3,
          1,
          -13
        ],
        "size": [
          6,
          5,
          6
        ],
        "uv": [
          3,
          0
        ],
        "name": "head",
        "pivot": [
          0,
          5,
          -10
        ]
      },
      {
        "origin": [
          -18,
          2,
          -6
        ],
        "size": [
          13,
          1,
          5
        ],
        "uv": [
          27,
          30
        ],
        "name": "right_front_leg",
        "pivot": [
          -5,
          3,
          -4
        ]
      },
      {
        "origin": [
          -5.5,
          1,
          11
        ],
        "size": [
          4,
          1,
          10
        ],
        "uv": [
          1,
          23
        ],
        "name": "right_hind_leg",
        "pivot": [
          -3.5,
          2,
          11
        ]
      },
      {
        "origin": [
          -4.5,
          -8,
          -24
        ],
        "size": [
          9,
          18,
          1
        ],
        "uv": [
          70,
          33
        ],
        "name": "egg_belly",
        "pivot": [
          0,
          13,
          -10
        ],
        "rotation": [
          -90,
          0,
          0
        ]
      },
      {
        "origin": [
          1.5,
          1,
          11
        ],
        "size": [
          4,
          1,
          10
        ],
        "uv": [
          1,
          12
        ],
        "name": "left_hind_leg",
        "pivot": [
          3.5,
          2,
          11
        ]
      },
      {
        "origin": [
          -9.5,
          -10,
          -20
        ],
        "size": [
          19,
          20,
          6
        ],
        "uv": [
          7,
          37
        ],
        "name": "body",
        "pivot": [
          0,
          13,
          -10
        ],
        "rotation": [
          -90,
          0,
          0
        ]
      },
      {
        "origin": [
          -5.5,
          -8,
          -23
        ],
        "size": [
          11,
          18,
          3
        ],
        "uv": [
          31,
          1
        ],
        "name": "body",
        "pivot": [
          0,
          13,
          -10
        ],
        "rotation": [
          -90,
          0,
          0
        ]
      },
      {
        "origin": [
          5,
          2,
          -6
        ],
        "size": [
          13,
          1,
          5
        ],
        "uv": [
          27,
          24
        ],
        "name": "left_front_leg",
        "pivot": [
          5,
          3,
          -4
        ]
      }
    ]
  },
  "strider": {
    "id": "strider",
    "textureSize": [
      64,
      128
    ],
    "cubes": [
      {
        "origin": [
          2,
          0,
          -2
        ],
        "size": [
          4,
          16,
          4
        ],
        "uv": [
          0,
          55
        ],
        "name": "left_leg",
        "pivot": [
          4,
          16,
          0
        ]
      },
      {
        "origin": [
          -6,
          0,
          -2
        ],
        "size": [
          4,
          16,
          4
        ],
        "uv": [
          0,
          32
        ],
        "name": "right_leg",
        "pivot": [
          -4,
          16,
          0
        ]
      },
      {
        "origin": [
          -8,
          15,
          -8
        ],
        "size": [
          16,
          14,
          16
        ],
        "uv": [
          0,
          0
        ],
        "name": "body",
        "pivot": [
          0,
          23,
          0
        ]
      },
      {
        "origin": [
          -20,
          28,
          -8
        ],
        "size": [
          12,
          0,
          16
        ],
        "uv": [
          16,
          33
        ],
        "name": "right_top_bristle",
        "poseParent": "body",
        "mirror": true,
        "pivot": [
          -8,
          28,
          -8
        ],
        "rotation": [
          0,
          0,
          -50
        ]
      },
      {
        "origin": [
          -20,
          19,
          -8
        ],
        "size": [
          12,
          0,
          16
        ],
        "uv": [
          16,
          65
        ],
        "name": "right_bottom_bristle",
        "poseParent": "body",
        "mirror": true,
        "pivot": [
          -8,
          19,
          -8
        ],
        "rotation": [
          0,
          0,
          -70
        ]
      },
      {
        "origin": [
          8,
          29,
          -8
        ],
        "size": [
          12,
          0,
          16
        ],
        "uv": [
          16,
          33
        ],
        "name": "left_top_bristle",
        "poseParent": "body",
        "pivot": [
          8,
          29,
          -8
        ],
        "rotation": [
          0,
          0,
          50
        ]
      },
      {
        "origin": [
          8,
          20,
          -8
        ],
        "size": [
          12,
          0,
          16
        ],
        "uv": [
          16,
          65
        ],
        "name": "left_bottom_bristle",
        "poseParent": "body",
        "pivot": [
          8,
          20,
          -8
        ],
        "rotation": [
          0,
          0,
          70
        ]
      },
      {
        "origin": [
          -20,
          24,
          -8
        ],
        "size": [
          12,
          0,
          16
        ],
        "uv": [
          16,
          49
        ],
        "name": "right_middle_bristle",
        "poseParent": "body",
        "mirror": true,
        "pivot": [
          -8,
          24,
          -8
        ],
        "rotation": [
          0,
          0,
          -65
        ]
      },
      {
        "origin": [
          8,
          25,
          -8
        ],
        "size": [
          12,
          0,
          16
        ],
        "uv": [
          16,
          49
        ],
        "name": "left_middle_bristle",
        "poseParent": "body",
        "pivot": [
          8,
          25,
          -8
        ],
        "rotation": [
          0,
          0,
          65
        ]
      }
    ]
  },
  "mooshroom": {
    "id": "mooshroom",
    "textureSize": [
      64,
      64
    ],
    "cubes": [
      {
        "origin": [
          -6,
          8,
          2
        ],
        "size": [
          12,
          18,
          10
        ],
        "uv": [
          18,
          4
        ],
        "name": "body",
        "pivot": [
          0,
          14,
          4
        ],
        "rotation": [
          -90,
          0,
          0
        ]
      },
      {
        "origin": [
          -2,
          8,
          1
        ],
        "size": [
          4,
          6,
          1
        ],
        "uv": [
          52,
          0
        ],
        "name": "body",
        "pivot": [
          0,
          14,
          4
        ],
        "rotation": [
          -90,
          0,
          0
        ]
      },
      {
        "origin": [
          -6,
          0,
          5
        ],
        "size": [
          4,
          12,
          4
        ],
        "uv": [
          0,
          16
        ],
        "name": "leg0",
        "poseParent": "body",
        "pivot": [
          -4,
          12,
          7
        ]
      },
      {
        "origin": [
          2,
          0,
          5
        ],
        "size": [
          4,
          12,
          4
        ],
        "uv": [
          0,
          16
        ],
        "name": "leg1",
        "poseParent": "body",
        "mirror": true,
        "pivot": [
          4,
          12,
          7
        ]
      },
      {
        "origin": [
          -6,
          0,
          -7
        ],
        "size": [
          4,
          12,
          4
        ],
        "uv": [
          0,
          16
        ],
        "name": "leg2",
        "poseParent": "body",
        "pivot": [
          -4,
          12,
          -6
        ]
      },
      {
        "origin": [
          2,
          0,
          -7
        ],
        "size": [
          4,
          12,
          4
        ],
        "uv": [
          0,
          16
        ],
        "name": "leg3",
        "poseParent": "body",
        "mirror": true,
        "pivot": [
          4,
          12,
          -6
        ]
      },
      {
        "origin": [
          -4,
          16,
          -14
        ],
        "size": [
          8,
          8,
          6
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "pivot": [
          0,
          20,
          -8
        ]
      },
      {
        "origin": [
          -5,
          22,
          -12
        ],
        "size": [
          1,
          3,
          1
        ],
        "uv": [
          22,
          0
        ],
        "name": "head",
        "pivot": [
          0,
          20,
          -8
        ]
      },
      {
        "origin": [
          4,
          22,
          -12
        ],
        "size": [
          1,
          3,
          1
        ],
        "uv": [
          22,
          0
        ],
        "name": "head",
        "pivot": [
          0,
          20,
          -8
        ]
      },
      {
        "origin": [
          -3,
          16,
          -15
        ],
        "size": [
          6,
          3,
          1
        ],
        "uv": [
          1,
          33
        ],
        "name": "head",
        "pivot": [
          0,
          20,
          -8
        ]
      }
    ]
  },
  "cat": {
    "id": "cat",
    "textureSize": [
      64,
      32
    ],
    "cubes": [
      {
        "origin": [
          -2,
          -1,
          -2
        ],
        "size": [
          4,
          16,
          6
        ],
        "uv": [
          20,
          0
        ],
        "name": "body",
        "pivot": [
          0,
          7,
          1
        ]
      },
      {
        "origin": [
          -2.5,
          7,
          -12
        ],
        "size": [
          5,
          4,
          5
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "poseParent": "body",
        "pivot": [
          0,
          9,
          -9
        ]
      },
      {
        "origin": [
          -1.5,
          7.016,
          -13
        ],
        "size": [
          3,
          2,
          2
        ],
        "uv": [
          0,
          24
        ],
        "name": "head",
        "poseParent": "body",
        "pivot": [
          0,
          9,
          -9
        ]
      },
      {
        "origin": [
          -2,
          11,
          -9
        ],
        "size": [
          1,
          1,
          2
        ],
        "uv": [
          0,
          10
        ],
        "name": "head",
        "poseParent": "body",
        "pivot": [
          0,
          9,
          -9
        ]
      },
      {
        "origin": [
          1,
          11,
          -9
        ],
        "size": [
          1,
          1,
          2
        ],
        "uv": [
          6,
          10
        ],
        "name": "head",
        "poseParent": "body",
        "pivot": [
          0,
          9,
          -9
        ]
      },
      {
        "origin": [
          -0.5,
          1,
          8
        ],
        "size": [
          1,
          8,
          1
        ],
        "uv": [
          0,
          15
        ],
        "name": "tail1",
        "poseParent": "body",
        "pivot": [
          0,
          9,
          8
        ]
      },
      {
        "origin": [
          -0.5,
          1,
          16
        ],
        "size": [
          1,
          8,
          1
        ],
        "uv": [
          4,
          15
        ],
        "name": "tail2",
        "poseParent": "tail1",
        "pivot": [
          0,
          9,
          16
        ]
      },
      {
        "origin": [
          0.1,
          0,
          6
        ],
        "size": [
          2,
          6,
          2
        ],
        "uv": [
          8,
          13
        ],
        "name": "back_leg_l",
        "poseParent": "body",
        "pivot": [
          1.1,
          6,
          7
        ]
      },
      {
        "origin": [
          -2.1,
          0,
          6
        ],
        "size": [
          2,
          6,
          2
        ],
        "uv": [
          8,
          13
        ],
        "name": "back_leg_r",
        "poseParent": "body",
        "pivot": [
          -1.1,
          6,
          7
        ]
      },
      {
        "origin": [
          0.2,
          0.2,
          -5
        ],
        "size": [
          2,
          10,
          2
        ],
        "uv": [
          40,
          0
        ],
        "name": "front_leg_l",
        "poseParent": "body",
        "pivot": [
          1.2,
          10,
          -4
        ]
      },
      {
        "origin": [
          -2.2,
          0.2,
          -5
        ],
        "size": [
          2,
          10,
          2
        ],
        "uv": [
          40,
          0
        ],
        "name": "front_leg_r",
        "poseParent": "body",
        "pivot": [
          -1.2,
          10,
          -4
        ]
      }
    ]
  },
  "ocelot": {
    "id": "ocelot",
    "textureSize": [
      64,
      32
    ],
    "cubes": [
      {
        "origin": [
          -2.5,
          7,
          -12
        ],
        "size": [
          5,
          4,
          5
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "pivot": [
          0,
          9,
          -9
        ]
      },
      {
        "origin": [
          -1.5,
          7.001,
          -13
        ],
        "size": [
          3,
          2,
          2
        ],
        "uv": [
          0,
          24
        ],
        "name": "head",
        "pivot": [
          0,
          9,
          -9
        ]
      },
      {
        "origin": [
          -2,
          11,
          -9
        ],
        "size": [
          1,
          1,
          2
        ],
        "uv": [
          0,
          10
        ],
        "name": "head",
        "pivot": [
          0,
          9,
          -9
        ]
      },
      {
        "origin": [
          1,
          11,
          -9
        ],
        "size": [
          1,
          1,
          2
        ],
        "uv": [
          6,
          10
        ],
        "name": "head",
        "pivot": [
          0,
          9,
          -9
        ]
      },
      {
        "origin": [
          -0.5,
          1,
          8
        ],
        "size": [
          1,
          8,
          1
        ],
        "uv": [
          0,
          15
        ],
        "name": "tail1",
        "pivot": [
          0,
          9,
          8
        ],
        "rotation": [
          -51.566,
          0,
          0
        ]
      },
      {
        "origin": [
          -2.2,
          -0.1,
          -5
        ],
        "size": [
          2,
          10,
          2
        ],
        "uv": [
          40,
          0
        ],
        "name": "right_front_leg",
        "pivot": [
          -1.2,
          9.9,
          -5
        ]
      },
      {
        "origin": [
          -0.5,
          -4,
          14
        ],
        "size": [
          1,
          8,
          1
        ],
        "uv": [
          4,
          15
        ],
        "name": "tail2",
        "pivot": [
          0,
          4,
          14
        ]
      },
      {
        "origin": [
          -2.1,
          0,
          6
        ],
        "size": [
          2,
          6,
          2
        ],
        "uv": [
          8,
          13
        ],
        "name": "right_hind_leg",
        "pivot": [
          -1.1,
          6,
          5
        ]
      },
      {
        "origin": [
          0.1,
          0,
          6
        ],
        "size": [
          2,
          6,
          2
        ],
        "uv": [
          8,
          13
        ],
        "name": "left_hind_leg",
        "pivot": [
          1.1,
          6,
          5
        ]
      },
      {
        "origin": [
          -2,
          -7,
          -18
        ],
        "size": [
          4,
          16,
          6
        ],
        "uv": [
          20,
          0
        ],
        "name": "body",
        "pivot": [
          0,
          12,
          -10
        ],
        "rotation": [
          -90,
          0,
          0
        ]
      },
      {
        "origin": [
          0.2,
          -0.1,
          -5
        ],
        "size": [
          2,
          10,
          2
        ],
        "uv": [
          40,
          0
        ],
        "name": "left_front_leg",
        "pivot": [
          1.2,
          9.9,
          -5
        ]
      }
    ]
  },
  "dolphin": {
    "id": "dolphin",
    "textureSize": [
      64,
      64
    ],
    "cubes": [
      {
        "origin": [
          -4,
          2,
          -5
        ],
        "size": [
          8,
          7,
          13
        ],
        "uv": [
          22,
          0
        ],
        "name": "body",
        "pivot": [
          0,
          2,
          -5
        ]
      },
      {
        "origin": [
          -4,
          2,
          -11
        ],
        "size": [
          8,
          7,
          6
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "poseParent": "body",
        "pivot": [
          0,
          6,
          -8
        ]
      },
      {
        "origin": [
          -1,
          2,
          -15
        ],
        "size": [
          2,
          2,
          4
        ],
        "uv": [
          0,
          13
        ],
        "name": "nose",
        "poseParent": "head",
        "pivot": [
          0,
          6,
          -8
        ]
      },
      {
        "origin": [
          1.5,
          4,
          -1
        ],
        "size": [
          1,
          4,
          7
        ],
        "uv": [
          48,
          20
        ],
        "name": "left_fin",
        "poseParent": "body",
        "mirror": true,
        "pivot": [
          2,
          4,
          -1
        ],
        "rotation": [
          -60,
          0,
          120
        ]
      },
      {
        "origin": [
          -2.5,
          4,
          -1
        ],
        "size": [
          1,
          4,
          7
        ],
        "uv": [
          48,
          20
        ],
        "name": "right_fin",
        "poseParent": "body",
        "pivot": [
          -2,
          4,
          -1
        ],
        "rotation": [
          -60,
          0,
          -120
        ]
      },
      {
        "origin": [
          -2,
          2,
          6
        ],
        "size": [
          4,
          5,
          11
        ],
        "uv": [
          0,
          19
        ],
        "name": "tail",
        "poseParent": "body",
        "pivot": [
          0,
          4.5,
          6
        ],
        "rotation": [
          6,
          0,
          0
        ]
      },
      {
        "origin": [
          -5,
          4,
          15
        ],
        "size": [
          10,
          1,
          6
        ],
        "uv": [
          19,
          20
        ],
        "name": "tail_fin",
        "poseParent": "tail",
        "pivot": [
          0,
          4.5,
          15
        ],
        "parents": [
          {
            "pivot": [
              0,
              4.5,
              6
            ],
            "rotation": [
              6,
              0,
              0
            ]
          }
        ]
      },
      {
        "origin": [
          -0.5,
          -2,
          3
        ],
        "size": [
          1,
          4,
          5
        ],
        "uv": [
          51,
          0
        ],
        "name": "back_fin",
        "poseParent": "body",
        "pivot": [
          0,
          2,
          -5
        ],
        "rotation": [
          -60,
          0,
          0
        ]
      }
    ]
  },
  "happy_ghast": {
    "id": "happy_ghast",
    "textureSize": [
      64,
      64
    ],
    "cubes": [
      {
        "origin": [
          -32,
          0,
          -32
        ],
        "size": [
          64,
          64,
          64
        ],
        "uv": {
          "north": {
            "uv": [
              16,
              16
            ],
            "uvSize": [
              16,
              16
            ]
          },
          "south": {
            "uv": [
              48,
              16
            ],
            "uvSize": [
              16,
              16
            ]
          },
          "east": {
            "uv": [
              0,
              16
            ],
            "uvSize": [
              16,
              16
            ]
          },
          "west": {
            "uv": [
              32,
              16
            ],
            "uvSize": [
              16,
              16
            ]
          },
          "up": {
            "uv": [
              16,
              0
            ],
            "uvSize": [
              16,
              16
            ]
          },
          "down": {
            "uv": [
              32,
              16
            ],
            "uvSize": [
              16,
              -16
            ]
          }
        },
        "name": "body",
        "pivot": [
          0,
          0,
          0
        ]
      },
      {
        "origin": [
          -30.5,
          1.5,
          -30.5
        ],
        "size": [
          61,
          61,
          61
        ],
        "uv": {
          "north": {
            "uv": [
              16,
              48
            ],
            "uvSize": [
              16,
              16
            ]
          },
          "south": {
            "uv": [
              48,
              48
            ],
            "uvSize": [
              16,
              16
            ]
          },
          "east": {
            "uv": [
              0,
              48
            ],
            "uvSize": [
              16,
              16
            ]
          },
          "west": {
            "uv": [
              32,
              48
            ],
            "uvSize": [
              16,
              16
            ]
          },
          "up": {
            "uv": [
              16,
              32
            ],
            "uvSize": [
              16,
              16
            ]
          },
          "down": {
            "uv": [
              32,
              48
            ],
            "uvSize": [
              16,
              -16
            ]
          }
        },
        "name": "body",
        "inflate": -0.5,
        "pivot": [
          0,
          0,
          0
        ]
      },
      {
        "origin": [
          -19.2,
          -16,
          -24
        ],
        "size": [
          8,
          20,
          8
        ],
        "uv": {
          "north": {
            "uv": [
              2,
              2
            ],
            "uvSize": [
              2,
              5
            ]
          },
          "south": {
            "uv": [
              6,
              2
            ],
            "uvSize": [
              2,
              5
            ]
          },
          "east": {
            "uv": [
              0,
              2
            ],
            "uvSize": [
              2,
              5
            ]
          },
          "west": {
            "uv": [
              4,
              2
            ],
            "uvSize": [
              2,
              5
            ]
          },
          "up": {
            "uv": [
              2,
              0
            ],
            "uvSize": [
              2,
              2
            ]
          },
          "down": {
            "uv": [
              4,
              2
            ],
            "uvSize": [
              2,
              -2
            ]
          }
        },
        "name": "tentacles_0",
        "poseParent": "body",
        "pivot": [
          -15.2,
          4,
          -20
        ]
      },
      {
        "origin": [
          1.2,
          -24,
          -24
        ],
        "size": [
          8,
          28,
          8
        ],
        "uv": {
          "north": {
            "uv": [
              2,
              2
            ],
            "uvSize": [
              2,
              7
            ]
          },
          "south": {
            "uv": [
              6,
              2
            ],
            "uvSize": [
              2,
              7
            ]
          },
          "east": {
            "uv": [
              0,
              2
            ],
            "uvSize": [
              2,
              7
            ]
          },
          "west": {
            "uv": [
              4,
              2
            ],
            "uvSize": [
              2,
              7
            ]
          },
          "up": {
            "uv": [
              2,
              0
            ],
            "uvSize": [
              2,
              2
            ]
          },
          "down": {
            "uv": [
              4,
              2
            ],
            "uvSize": [
              2,
              -2
            ]
          }
        },
        "name": "tentacles_1",
        "poseParent": "body",
        "pivot": [
          5.2,
          4,
          -20
        ]
      },
      {
        "origin": [
          21.2,
          -12,
          -24
        ],
        "size": [
          8,
          16,
          8
        ],
        "uv": {
          "north": {
            "uv": [
              2,
              2
            ],
            "uvSize": [
              2,
              4
            ]
          },
          "south": {
            "uv": [
              6,
              2
            ],
            "uvSize": [
              2,
              4
            ]
          },
          "east": {
            "uv": [
              0,
              2
            ],
            "uvSize": [
              2,
              4
            ]
          },
          "west": {
            "uv": [
              4,
              2
            ],
            "uvSize": [
              2,
              4
            ]
          },
          "up": {
            "uv": [
              2,
              0
            ],
            "uvSize": [
              2,
              2
            ]
          },
          "down": {
            "uv": [
              4,
              2
            ],
            "uvSize": [
              2,
              -2
            ]
          }
        },
        "name": "tentacles_2",
        "poseParent": "body",
        "pivot": [
          25.2,
          4,
          -20
        ]
      },
      {
        "origin": [
          -29.2,
          -16,
          -4
        ],
        "size": [
          8,
          20,
          8
        ],
        "uv": {
          "north": {
            "uv": [
              2,
              2
            ],
            "uvSize": [
              2,
              5
            ]
          },
          "south": {
            "uv": [
              6,
              2
            ],
            "uvSize": [
              2,
              5
            ]
          },
          "east": {
            "uv": [
              0,
              2
            ],
            "uvSize": [
              2,
              5
            ]
          },
          "west": {
            "uv": [
              4,
              2
            ],
            "uvSize": [
              2,
              5
            ]
          },
          "up": {
            "uv": [
              2,
              0
            ],
            "uvSize": [
              2,
              2
            ]
          },
          "down": {
            "uv": [
              4,
              2
            ],
            "uvSize": [
              2,
              -2
            ]
          }
        },
        "name": "tentacles_3",
        "poseParent": "body",
        "pivot": [
          -25.2,
          4,
          0
        ]
      },
      {
        "origin": [
          -9.2,
          -16,
          -4
        ],
        "size": [
          8,
          20,
          8
        ],
        "uv": {
          "north": {
            "uv": [
              2,
              2
            ],
            "uvSize": [
              2,
              5
            ]
          },
          "south": {
            "uv": [
              6,
              2
            ],
            "uvSize": [
              2,
              5
            ]
          },
          "east": {
            "uv": [
              0,
              2
            ],
            "uvSize": [
              2,
              5
            ]
          },
          "west": {
            "uv": [
              4,
              2
            ],
            "uvSize": [
              2,
              5
            ]
          },
          "up": {
            "uv": [
              2,
              0
            ],
            "uvSize": [
              2,
              2
            ]
          },
          "down": {
            "uv": [
              4,
              2
            ],
            "uvSize": [
              2,
              -2
            ]
          }
        },
        "name": "tentacles_4",
        "poseParent": "body",
        "pivot": [
          -5.2,
          4,
          0
        ]
      },
      {
        "origin": [
          11.2,
          -24,
          -4
        ],
        "size": [
          8,
          28,
          8
        ],
        "uv": {
          "north": {
            "uv": [
              2,
              2
            ],
            "uvSize": [
              2,
              7
            ]
          },
          "south": {
            "uv": [
              6,
              2
            ],
            "uvSize": [
              2,
              7
            ]
          },
          "east": {
            "uv": [
              0,
              2
            ],
            "uvSize": [
              2,
              7
            ]
          },
          "west": {
            "uv": [
              4,
              2
            ],
            "uvSize": [
              2,
              7
            ]
          },
          "up": {
            "uv": [
              2,
              0
            ],
            "uvSize": [
              2,
              2
            ]
          },
          "down": {
            "uv": [
              4,
              2
            ],
            "uvSize": [
              2,
              -2
            ]
          }
        },
        "name": "tentacles_5",
        "poseParent": "body",
        "pivot": [
          15.2,
          4,
          0
        ]
      },
      {
        "origin": [
          -19.2,
          -28,
          16
        ],
        "size": [
          8,
          32,
          8
        ],
        "uv": {
          "north": {
            "uv": [
              2,
              2
            ],
            "uvSize": [
              2,
              8
            ]
          },
          "south": {
            "uv": [
              6,
              2
            ],
            "uvSize": [
              2,
              8
            ]
          },
          "east": {
            "uv": [
              0,
              2
            ],
            "uvSize": [
              2,
              8
            ]
          },
          "west": {
            "uv": [
              4,
              2
            ],
            "uvSize": [
              2,
              8
            ]
          },
          "up": {
            "uv": [
              2,
              0
            ],
            "uvSize": [
              2,
              2
            ]
          },
          "down": {
            "uv": [
              4,
              2
            ],
            "uvSize": [
              2,
              -2
            ]
          }
        },
        "name": "tentacles_6",
        "poseParent": "body",
        "pivot": [
          -15.2,
          4,
          20
        ]
      },
      {
        "origin": [
          1.2,
          -28,
          16
        ],
        "size": [
          8,
          32,
          8
        ],
        "uv": {
          "north": {
            "uv": [
              2,
              2
            ],
            "uvSize": [
              2,
              8
            ]
          },
          "south": {
            "uv": [
              6,
              2
            ],
            "uvSize": [
              2,
              8
            ]
          },
          "east": {
            "uv": [
              0,
              2
            ],
            "uvSize": [
              2,
              8
            ]
          },
          "west": {
            "uv": [
              4,
              2
            ],
            "uvSize": [
              2,
              8
            ]
          },
          "up": {
            "uv": [
              2,
              0
            ],
            "uvSize": [
              2,
              2
            ]
          },
          "down": {
            "uv": [
              4,
              2
            ],
            "uvSize": [
              2,
              -2
            ]
          }
        },
        "name": "tentacles_7",
        "poseParent": "body",
        "pivot": [
          5.2,
          4,
          20
        ]
      },
      {
        "origin": [
          21.2,
          -16,
          16
        ],
        "size": [
          8,
          20,
          8
        ],
        "uv": {
          "north": {
            "uv": [
              2,
              2
            ],
            "uvSize": [
              2,
              5
            ]
          },
          "south": {
            "uv": [
              6,
              2
            ],
            "uvSize": [
              2,
              5
            ]
          },
          "east": {
            "uv": [
              0,
              2
            ],
            "uvSize": [
              2,
              5
            ]
          },
          "west": {
            "uv": [
              4,
              2
            ],
            "uvSize": [
              2,
              5
            ]
          },
          "up": {
            "uv": [
              2,
              0
            ],
            "uvSize": [
              2,
              2
            ]
          },
          "down": {
            "uv": [
              4,
              2
            ],
            "uvSize": [
              2,
              -2
            ]
          }
        },
        "name": "tentacles_8",
        "poseParent": "body",
        "pivot": [
          25.2,
          4,
          20
        ]
      }
    ]
  },
  "baby_wolf": {
    "id": "baby_wolf",
    "textureSize": [
      32,
      32
    ],
    "cubes": [
      {
        "origin": [
          -2.99,
          4,
          -7
        ],
        "size": [
          6,
          5,
          5
        ],
        "uv": [
          0,
          12
        ],
        "name": "head",
        "poseParent": "body",
        "inflate": 0.025,
        "pivot": [
          0,
          5.75,
          -4
        ]
      },
      {
        "origin": [
          -1.5,
          3.99,
          -9
        ],
        "size": [
          3,
          2,
          2
        ],
        "uv": [
          17,
          12
        ],
        "name": "head",
        "poseParent": "body",
        "pivot": [
          0,
          5.75,
          -4
        ]
      },
      {
        "origin": [
          -3,
          9,
          -5
        ],
        "size": [
          2,
          2,
          1
        ],
        "uv": [
          0,
          5
        ],
        "name": "right_ear",
        "poseParent": "head",
        "pivot": [
          -2,
          10,
          -4.5
        ]
      },
      {
        "origin": [
          1,
          9,
          -5
        ],
        "size": [
          2,
          2,
          1
        ],
        "uv": [
          20,
          5
        ],
        "name": "left_ear",
        "poseParent": "head",
        "pivot": [
          2,
          10,
          -4.5
        ]
      },
      {
        "origin": [
          -3,
          3,
          -4
        ],
        "size": [
          6,
          4,
          8
        ],
        "uv": [
          0,
          0
        ],
        "name": "body",
        "pivot": [
          0,
          5,
          0
        ]
      },
      {
        "origin": [
          -2.5,
          0,
          2
        ],
        "size": [
          2,
          3,
          2
        ],
        "uv": [
          0,
          22
        ],
        "name": "leg0",
        "poseParent": "body",
        "pivot": [
          -1.5,
          3,
          3
        ]
      },
      {
        "origin": [
          0.5,
          0,
          2
        ],
        "size": [
          2,
          3,
          2
        ],
        "uv": [
          8,
          22
        ],
        "name": "leg1",
        "poseParent": "body",
        "pivot": [
          1.5,
          3,
          3
        ]
      },
      {
        "origin": [
          -2.5,
          0,
          -4
        ],
        "size": [
          2,
          3,
          2
        ],
        "uv": [
          0,
          0
        ],
        "name": "leg2",
        "poseParent": "body",
        "pivot": [
          -1.5,
          3,
          -3
        ]
      },
      {
        "origin": [
          0.5,
          0,
          -4
        ],
        "size": [
          2,
          3,
          2
        ],
        "uv": [
          20,
          0
        ],
        "name": "leg3",
        "poseParent": "body",
        "pivot": [
          1.5,
          3,
          -3
        ]
      },
      {
        "origin": [
          -1,
          5.3,
          2.2
        ],
        "size": [
          2,
          6,
          2
        ],
        "uv": [
          22,
          16
        ],
        "name": "tail",
        "poseParent": "body",
        "pivot": [
          0,
          5.6,
          3.2
        ],
        "rotation": [
          -180,
          0,
          0
        ]
      }
    ]
  },
  "baby_villager": {
    "id": "baby_villager",
    "textureSize": [
      64,
      64
    ],
    "cubes": [
      {
        "origin": [
          -2,
          3,
          -1.5
        ],
        "size": [
          4,
          5,
          3
        ],
        "uv": [
          0,
          15
        ],
        "name": "body",
        "pivot": [
          0,
          5.25,
          0
        ]
      },
      {
        "origin": [
          -2,
          2,
          -1.5
        ],
        "size": [
          4,
          6,
          3
        ],
        "uv": [
          16,
          21
        ],
        "name": "body",
        "inflate": 0.2,
        "pivot": [
          0,
          5.25,
          0
        ]
      },
      {
        "origin": [
          -4,
          8,
          -3.5
        ],
        "size": [
          8,
          8,
          7
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "poseParent": "body",
        "pivot": [
          0,
          8,
          0
        ]
      },
      {
        "origin": [
          -4,
          8,
          -3.5
        ],
        "size": [
          8,
          8,
          7
        ],
        "uv": [
          0,
          30
        ],
        "name": "helmet",
        "poseParent": "head",
        "inflate": 0.3,
        "pivot": [
          0,
          12,
          0
        ]
      },
      {
        "origin": [
          -7,
          12,
          -6
        ],
        "size": [
          14,
          1,
          12
        ],
        "uv": [
          0,
          45
        ],
        "name": "brim",
        "poseParent": "head",
        "pivot": [
          0,
          12.5,
          0
        ]
      },
      {
        "origin": [
          -1,
          8,
          -4.5
        ],
        "size": [
          2,
          2,
          1
        ],
        "uv": [
          23,
          0
        ],
        "name": "nose",
        "poseParent": "head",
        "pivot": [
          0,
          10,
          -4
        ]
      },
      {
        "origin": [
          -2,
          4.59,
          -2.8
        ],
        "size": [
          4,
          2,
          2
        ],
        "uv": [
          24,
          17
        ],
        "name": "arms",
        "poseParent": "body",
        "pivot": [
          0,
          5.598,
          -1.817
        ],
        "rotation": [
          60,
          0,
          0
        ]
      },
      {
        "origin": [
          2,
          3.59,
          -2.8
        ],
        "size": [
          2,
          4,
          2
        ],
        "uv": [
          16,
          15
        ],
        "name": "arms",
        "poseParent": "body",
        "pivot": [
          3,
          5.098,
          -0.96
        ],
        "rotation": [
          60,
          0,
          0
        ]
      },
      {
        "origin": [
          -4,
          3.59,
          -2.8
        ],
        "size": [
          2,
          4,
          2
        ],
        "uv": [
          36,
          15
        ],
        "name": "arms",
        "poseParent": "body",
        "pivot": [
          -3,
          5.098,
          -0.96
        ],
        "rotation": [
          60,
          0,
          0
        ]
      },
      {
        "origin": [
          -2,
          0,
          -1
        ],
        "size": [
          2,
          3,
          2
        ],
        "uv": [
          8,
          23
        ],
        "name": "leg0",
        "poseParent": "body",
        "pivot": [
          -1,
          2.5,
          0
        ]
      },
      {
        "origin": [
          0,
          0,
          -1
        ],
        "size": [
          2,
          3,
          2
        ],
        "uv": [
          0,
          23
        ],
        "name": "leg1",
        "poseParent": "body",
        "pivot": [
          1,
          2.5,
          0
        ]
      }
    ]
  },
  "baby_donkey": {
    "id": "baby_donkey",
    "textureSize": [
      64,
      64
    ],
    "cubes": [
      {
        "origin": [
          -4,
          8,
          -7
        ],
        "size": [
          8,
          6,
          14
        ],
        "uv": [
          0,
          13
        ],
        "name": "body",
        "pivot": [
          0,
          10,
          0
        ]
      },
      {
        "origin": [
          -1.5,
          10.5,
          6
        ],
        "size": [
          3,
          3,
          8
        ],
        "uv": [
          24,
          33
        ],
        "name": "tail",
        "pivot": [
          0,
          12.5,
          6.5
        ],
        "rotation": [
          42.5,
          0,
          0
        ]
      },
      {
        "origin": [
          1,
          0,
          4
        ],
        "size": [
          3,
          8,
          3
        ],
        "uv": [
          12,
          44
        ],
        "name": "leg_bl",
        "pivot": [
          2.5,
          6.5,
          5.5
        ]
      },
      {
        "origin": [
          -4,
          0,
          4
        ],
        "size": [
          3,
          8,
          3
        ],
        "uv": [
          0,
          44
        ],
        "name": "leg_br",
        "pivot": [
          -2.5,
          6.5,
          5.5
        ]
      },
      {
        "origin": [
          1,
          0,
          -7
        ],
        "size": [
          3,
          8,
          3
        ],
        "uv": [
          12,
          33
        ],
        "name": "leg_fl",
        "pivot": [
          2.5,
          6.5,
          -5.5
        ]
      },
      {
        "origin": [
          -4,
          0,
          -7
        ],
        "size": [
          3,
          8,
          3
        ],
        "uv": [
          0,
          33
        ],
        "name": "leg_fr",
        "pivot": [
          -2.5,
          6.5,
          -5.5
        ]
      },
      {
        "origin": [
          0.038,
          21.287,
          -8.59
        ],
        "size": [
          2,
          7,
          1
        ],
        "uv": [
          0,
          0
        ],
        "name": "left_ear",
        "poseParent": "head",
        "pivot": [
          2.5,
          20.5,
          -9
        ],
        "rotation": [
          -27.5,
          0,
          -27.5
        ]
      },
      {
        "origin": [
          -2.038,
          21.287,
          -8.59
        ],
        "size": [
          2,
          7,
          1
        ],
        "uv": [
          22,
          0
        ],
        "name": "right_ear",
        "poseParent": "head",
        "mirror": true,
        "pivot": [
          -2.5,
          20.5,
          -9
        ],
        "rotation": [
          -27.5,
          0,
          27.5
        ]
      },
      {
        "origin": [
          -3,
          19.6,
          -15.4
        ],
        "size": [
          6,
          4,
          9
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "poseParent": "neck",
        "pivot": [
          0,
          20,
          -7
        ],
        "rotation": [
          -22.5,
          0,
          0
        ]
      },
      {
        "origin": [
          -2,
          12,
          -8
        ],
        "size": [
          4,
          8,
          4
        ],
        "uv": [
          30,
          9
        ],
        "name": "neck",
        "pivot": [
          0,
          14,
          -5
        ],
        "rotation": [
          -22.5,
          0,
          0
        ]
      }
    ]
  },
  "baby_cow": {
    "id": "baby_cow",
    "textureSize": [
      64,
      64
    ],
    "cubes": [
      {
        "origin": [
          -3,
          9,
          -10
        ],
        "size": [
          6,
          6,
          5
        ],
        "uv": [
          0,
          18
        ],
        "name": "head",
        "pivot": [
          0,
          10.431,
          -5.167
        ]
      },
      {
        "origin": [
          3,
          14,
          -9
        ],
        "size": [
          1,
          2,
          1
        ],
        "uv": [
          8,
          29
        ],
        "name": "head",
        "pivot": [
          0,
          10.431,
          -5.167
        ]
      },
      {
        "origin": [
          -4,
          14,
          -9
        ],
        "size": [
          1,
          2,
          1
        ],
        "uv": [
          4,
          29
        ],
        "name": "head",
        "mirror": true,
        "pivot": [
          0,
          10.431,
          -5.167
        ]
      },
      {
        "origin": [
          -2,
          9,
          -11
        ],
        "size": [
          4,
          3,
          1
        ],
        "uv": [
          12,
          29
        ],
        "name": "head",
        "pivot": [
          0,
          10.431,
          -5.167
        ]
      },
      {
        "origin": [
          -4,
          6,
          -6
        ],
        "size": [
          8,
          6,
          12
        ],
        "uv": [
          0,
          0
        ],
        "name": "body",
        "pivot": [
          0,
          9,
          0
        ]
      },
      {
        "origin": [
          -3.975,
          0,
          2
        ],
        "size": [
          3,
          6,
          3
        ],
        "uv": [
          22,
          27
        ],
        "name": "leg0",
        "pivot": [
          -2.475,
          6,
          3.5
        ]
      },
      {
        "origin": [
          0.975,
          0,
          2
        ],
        "size": [
          3,
          6,
          3
        ],
        "uv": [
          34,
          27
        ],
        "name": "leg1",
        "pivot": [
          2.475,
          6,
          3.5
        ]
      },
      {
        "origin": [
          -3.975,
          0,
          -5
        ],
        "size": [
          3,
          6,
          3
        ],
        "uv": [
          22,
          18
        ],
        "name": "leg2",
        "pivot": [
          -2.475,
          6,
          -3.5
        ]
      },
      {
        "origin": [
          0.975,
          0,
          -5
        ],
        "size": [
          3,
          6,
          3
        ],
        "uv": [
          34,
          18
        ],
        "name": "leg3",
        "pivot": [
          2.475,
          6,
          -3.5
        ]
      }
    ]
  },
  "baby_mooshroom": {
    "id": "baby_mooshroom",
    "textureSize": [
      64,
      64
    ],
    "cubes": [
      {
        "origin": [
          -3,
          9,
          -10
        ],
        "size": [
          6,
          6,
          5
        ],
        "uv": [
          0,
          18
        ],
        "name": "head",
        "pivot": [
          0,
          10.431,
          -5.167
        ]
      },
      {
        "origin": [
          3,
          14,
          -9
        ],
        "size": [
          1,
          2,
          1
        ],
        "uv": [
          8,
          29
        ],
        "name": "head",
        "pivot": [
          0,
          10.431,
          -5.167
        ]
      },
      {
        "origin": [
          -4,
          14,
          -9
        ],
        "size": [
          1,
          2,
          1
        ],
        "uv": [
          4,
          29
        ],
        "name": "head",
        "mirror": true,
        "pivot": [
          0,
          10.431,
          -5.167
        ]
      },
      {
        "origin": [
          -2,
          9,
          -11
        ],
        "size": [
          4,
          3,
          1
        ],
        "uv": [
          12,
          29
        ],
        "name": "head",
        "pivot": [
          0,
          10.431,
          -5.167
        ]
      },
      {
        "origin": [
          -4,
          6,
          -6
        ],
        "size": [
          8,
          6,
          12
        ],
        "uv": [
          0,
          0
        ],
        "name": "body",
        "pivot": [
          0,
          9,
          0
        ]
      },
      {
        "origin": [
          -3.975,
          0,
          2
        ],
        "size": [
          3,
          6,
          3
        ],
        "uv": [
          22,
          27
        ],
        "name": "leg0",
        "pivot": [
          -2.475,
          6,
          3.5
        ]
      },
      {
        "origin": [
          0.975,
          0,
          2
        ],
        "size": [
          3,
          6,
          3
        ],
        "uv": [
          34,
          27
        ],
        "name": "leg1",
        "pivot": [
          2.475,
          6,
          3.5
        ]
      },
      {
        "origin": [
          -3.975,
          0,
          -5
        ],
        "size": [
          3,
          6,
          3
        ],
        "uv": [
          22,
          18
        ],
        "name": "leg2",
        "pivot": [
          -2.475,
          6,
          -3.5
        ]
      },
      {
        "origin": [
          0.975,
          0,
          -5
        ],
        "size": [
          3,
          6,
          3
        ],
        "uv": [
          34,
          18
        ],
        "name": "leg3",
        "pivot": [
          2.475,
          6,
          -3.5
        ]
      }
    ]
  },
  "baby_pig": {
    "id": "baby_pig",
    "textureSize": [
      32,
      32
    ],
    "cubes": [
      {
        "origin": [
          -3.5,
          2,
          -4
        ],
        "size": [
          7,
          6,
          9
        ],
        "uv": [
          0,
          0
        ],
        "name": "body",
        "pivot": [
          0,
          5,
          0.5
        ]
      },
      {
        "origin": [
          -3.51,
          4,
          -7
        ],
        "size": [
          7.02,
          6,
          6
        ],
        "uv": [
          0,
          15
        ],
        "name": "head",
        "pivot": [
          0,
          5,
          -2
        ]
      },
      {
        "origin": [
          -1.5,
          5,
          -8
        ],
        "size": [
          3,
          2,
          1
        ],
        "uv": [
          6,
          27
        ],
        "name": "head",
        "pivot": [
          0,
          5,
          -2
        ]
      },
      {
        "origin": [
          -3.475,
          0,
          3
        ],
        "size": [
          2,
          2,
          2
        ],
        "uv": [
          23,
          4
        ],
        "name": "leg0",
        "pivot": [
          -2.5,
          2,
          4
        ]
      },
      {
        "origin": [
          1.475,
          0,
          3
        ],
        "size": [
          2,
          2,
          2
        ],
        "uv": [
          0,
          4
        ],
        "name": "leg1",
        "pivot": [
          2.5,
          2,
          4
        ]
      },
      {
        "origin": [
          1.475,
          0,
          -4
        ],
        "size": [
          2,
          2,
          2
        ],
        "uv": [
          0,
          0
        ],
        "name": "leg3",
        "pivot": [
          2.5,
          2,
          -3
        ]
      },
      {
        "origin": [
          -3.475,
          0,
          -4
        ],
        "size": [
          2,
          2,
          2
        ],
        "uv": [
          23,
          0
        ],
        "name": "leg2",
        "pivot": [
          -2.5,
          2,
          -3
        ]
      }
    ]
  },
  "baby_chicken": {
    "id": "baby_chicken",
    "textureSize": [
      16,
      16
    ],
    "cubes": [
      {
        "origin": [
          -2,
          2,
          -2
        ],
        "size": [
          4,
          4,
          4
        ],
        "uv": [
          0,
          0
        ],
        "name": "body",
        "pivot": [
          0,
          3.75,
          -1.25
        ]
      },
      {
        "origin": [
          -1,
          3,
          -3
        ],
        "size": [
          2,
          1,
          1
        ],
        "uv": [
          10,
          8
        ],
        "name": "body",
        "pivot": [
          0,
          3.75,
          -1.25
        ]
      },
      {
        "origin": [
          -1.5,
          0,
          0.5
        ],
        "size": [
          1,
          2,
          0
        ],
        "uv": [
          0,
          2
        ],
        "name": "leg0",
        "pivot": [
          -1,
          2,
          0.5
        ]
      },
      {
        "origin": [
          -1.5,
          0,
          -0.5
        ],
        "size": [
          1,
          0,
          1
        ],
        "uv": [
          0,
          0
        ],
        "name": "leg0",
        "pivot": [
          -1,
          2,
          0.5
        ]
      },
      {
        "origin": [
          0.5,
          0,
          0.5
        ],
        "size": [
          1,
          2,
          0
        ],
        "uv": [
          2,
          2
        ],
        "name": "leg1",
        "pivot": [
          1,
          2,
          0.5
        ]
      },
      {
        "origin": [
          0.5,
          0,
          -0.5
        ],
        "size": [
          1,
          0,
          1
        ],
        "uv": [
          0,
          1
        ],
        "name": "leg1",
        "pivot": [
          1,
          2,
          0.5
        ]
      },
      {
        "origin": [
          -3,
          4,
          -1
        ],
        "size": [
          1,
          0,
          2
        ],
        "uv": [
          4,
          8
        ],
        "name": "wing0",
        "pivot": [
          -2,
          4,
          0
        ]
      },
      {
        "origin": [
          2,
          4,
          -1
        ],
        "size": [
          1,
          0,
          2
        ],
        "uv": [
          6,
          8
        ],
        "name": "wing1",
        "pivot": [
          2,
          4,
          0
        ]
      }
    ]
  },
  "baby_horse": {
    "id": "baby_horse",
    "textureSize": [
      64,
      64
    ],
    "cubes": [
      {
        "origin": [
          -4,
          8,
          -7
        ],
        "size": [
          8,
          7,
          14
        ],
        "uv": [
          0,
          13
        ],
        "name": "body",
        "pivot": [
          0,
          11.5,
          0
        ]
      },
      {
        "origin": [
          -1.5,
          11,
          6
        ],
        "size": [
          3,
          3,
          8
        ],
        "uv": [
          24,
          34
        ],
        "name": "tail",
        "poseParent": "body",
        "pivot": [
          0,
          12.5,
          7
        ],
        "rotation": [
          42.5,
          0,
          0
        ]
      },
      {
        "origin": [
          0.9,
          0,
          3.9
        ],
        "size": [
          3,
          9,
          3
        ],
        "uv": [
          12,
          46
        ],
        "name": "leg_bl",
        "poseParent": "body",
        "pivot": [
          2.4,
          8,
          5.4
        ]
      },
      {
        "origin": [
          -3.9,
          0,
          3.9
        ],
        "size": [
          3,
          9,
          3
        ],
        "uv": [
          0,
          46
        ],
        "name": "leg_br",
        "poseParent": "body",
        "pivot": [
          -2.4,
          8,
          5.4
        ]
      },
      {
        "origin": [
          0.9,
          0,
          -6.9
        ],
        "size": [
          3,
          9,
          3
        ],
        "uv": [
          12,
          34
        ],
        "name": "leg_fl",
        "poseParent": "body",
        "pivot": [
          2.4,
          8,
          -5.4
        ]
      },
      {
        "origin": [
          -3.9,
          0,
          -6.9
        ],
        "size": [
          3,
          9,
          3
        ],
        "uv": [
          0,
          34
        ],
        "name": "leg_fr",
        "poseParent": "body",
        "pivot": [
          -2.4,
          8,
          -5.4
        ]
      },
      {
        "origin": [
          -2,
          12,
          -8
        ],
        "size": [
          4,
          8,
          4
        ],
        "uv": [
          30,
          0
        ],
        "name": "neck",
        "poseParent": "body",
        "pivot": [
          0,
          14,
          -6
        ],
        "rotation": [
          -35,
          0,
          0
        ]
      },
      {
        "origin": [
          -3,
          20,
          -13
        ],
        "size": [
          6,
          4,
          9
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "poseParent": "neck",
        "pivot": [
          0,
          20.052,
          -6.295
        ],
        "parents": [
          {
            "pivot": [
              0,
              14,
              -6
            ],
            "rotation": [
              -35,
              0,
              0
            ]
          }
        ]
      },
      {
        "origin": [
          1,
          23.8,
          -5.15
        ],
        "size": [
          2,
          3,
          1
        ],
        "uv": [
          0,
          4
        ],
        "name": "ear_l",
        "poseParent": "head",
        "pivot": [
          2,
          24.3,
          -4.35
        ],
        "rotation": [
          0,
          0,
          -15
        ],
        "parents": [
          {
            "pivot": [
              0,
              14,
              -6
            ],
            "rotation": [
              -35,
              0,
              0
            ]
          }
        ]
      },
      {
        "origin": [
          -3,
          23.8,
          -5.15
        ],
        "size": [
          2,
          3,
          1
        ],
        "uv": [
          0,
          0
        ],
        "name": "ear_r",
        "poseParent": "head",
        "pivot": [
          -2,
          24.3,
          -4.65
        ],
        "rotation": [
          0,
          0,
          15
        ],
        "parents": [
          {
            "pivot": [
              0,
              14,
              -6
            ],
            "rotation": [
              -35,
              0,
              0
            ]
          }
        ]
      }
    ]
  },
  "baby_cat": {
    "id": "baby_cat",
    "textureSize": [
      32,
      32
    ],
    "cubes": [
      {
        "origin": [
          -2,
          2,
          -3
        ],
        "size": [
          4,
          3,
          7
        ],
        "uv": [
          0,
          8
        ],
        "name": "belly",
        "poseParent": "body",
        "pivot": [
          0,
          3.5,
          0.5
        ]
      },
      {
        "origin": [
          -2.5,
          3,
          -6
        ],
        "size": [
          5,
          4,
          4
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "poseParent": "body",
        "pivot": [
          0,
          4,
          -3.125
        ]
      },
      {
        "origin": [
          -2,
          7,
          -4
        ],
        "size": [
          1,
          1,
          2
        ],
        "uv": [
          18,
          0
        ],
        "name": "head",
        "poseParent": "body",
        "pivot": [
          0,
          4,
          -3.125
        ]
      },
      {
        "origin": [
          1,
          7,
          -4
        ],
        "size": [
          1,
          1,
          2
        ],
        "uv": [
          24,
          0
        ],
        "name": "head",
        "poseParent": "body",
        "pivot": [
          0,
          4,
          -3.125
        ]
      },
      {
        "origin": [
          -1.5,
          3,
          -7
        ],
        "size": [
          3,
          2,
          1
        ],
        "uv": [
          18,
          3
        ],
        "name": "head",
        "poseParent": "body",
        "pivot": [
          0,
          4,
          -3.125
        ]
      },
      {
        "origin": [
          -0.5,
          4,
          4
        ],
        "size": [
          1,
          1,
          5
        ],
        "uv": [
          0,
          18
        ],
        "name": "tail1",
        "poseParent": "body",
        "pivot": [
          0,
          4.893,
          3.915
        ],
        "rotation": [
          32.5,
          0,
          0
        ]
      },
      {
        "origin": [
          0.5,
          0,
          1.5
        ],
        "size": [
          1,
          2,
          2
        ],
        "uv": [
          18,
          22
        ],
        "name": "back_leg_l",
        "poseParent": "body",
        "pivot": [
          1,
          2,
          2.5
        ]
      },
      {
        "origin": [
          -1.5,
          0,
          1.5
        ],
        "size": [
          1,
          2,
          2
        ],
        "uv": [
          12,
          22
        ],
        "name": "back_leg_r",
        "poseParent": "body",
        "pivot": [
          -1,
          2,
          2.5
        ]
      },
      {
        "origin": [
          0.5,
          0,
          -2.5
        ],
        "size": [
          1,
          2,
          2
        ],
        "uv": [
          18,
          18
        ],
        "name": "front_leg_l",
        "poseParent": "body",
        "pivot": [
          1,
          2,
          -1.5
        ]
      },
      {
        "origin": [
          -1.5,
          0,
          -2.5
        ],
        "size": [
          1,
          2,
          2
        ],
        "uv": [
          12,
          18
        ],
        "name": "front_leg_r",
        "poseParent": "body",
        "pivot": [
          -1,
          2,
          -1.5
        ]
      }
    ]
  },
  "baby_fox": {
    "id": "baby_fox",
    "textureSize": [
      32,
      32
    ],
    "cubes": [
      {
        "origin": [
          -3,
          3,
          -5
        ],
        "size": [
          6,
          5,
          5
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "pivot": [
          0,
          5.875,
          0.125
        ]
      },
      {
        "origin": [
          -1,
          3,
          -7
        ],
        "size": [
          2,
          2,
          2
        ],
        "uv": [
          18,
          20
        ],
        "name": "head",
        "pivot": [
          0,
          5.875,
          0.125
        ]
      },
      {
        "origin": [
          -3,
          8,
          -4
        ],
        "size": [
          2,
          2,
          1
        ],
        "uv": [
          22,
          8
        ],
        "name": "head",
        "pivot": [
          0,
          5.875,
          0.125
        ]
      },
      {
        "origin": [
          1,
          8,
          -4
        ],
        "size": [
          2,
          2,
          1
        ],
        "uv": [
          22,
          11
        ],
        "name": "head",
        "pivot": [
          0,
          5.875,
          0.125
        ]
      },
      {
        "origin": [
          -2.5,
          0,
          3
        ],
        "size": [
          2,
          2,
          2
        ],
        "uv": [
          22,
          4
        ],
        "name": "leg0",
        "pivot": [
          -1.5,
          2,
          4
        ]
      },
      {
        "origin": [
          0.5,
          0,
          3
        ],
        "size": [
          2,
          2,
          2
        ],
        "uv": [
          22,
          0
        ],
        "name": "leg1",
        "pivot": [
          1.5,
          2,
          4
        ]
      },
      {
        "origin": [
          -2.5,
          0,
          -1
        ],
        "size": [
          2,
          2,
          2
        ],
        "uv": [
          22,
          4
        ],
        "name": "leg2",
        "pivot": [
          -1.5,
          2,
          0
        ]
      },
      {
        "origin": [
          0.5,
          0,
          -1
        ],
        "size": [
          2,
          2,
          2
        ],
        "uv": [
          22,
          0
        ],
        "name": "leg3",
        "pivot": [
          1.5,
          2,
          0
        ]
      },
      {
        "origin": [
          -2.5,
          2,
          -1
        ],
        "size": [
          5,
          4,
          6
        ],
        "uv": [
          0,
          10
        ],
        "name": "body",
        "pivot": [
          0,
          4,
          2
        ]
      },
      {
        "origin": [
          -1.5,
          2.98,
          4
        ],
        "size": [
          3,
          3,
          6
        ],
        "uv": [
          0,
          20
        ],
        "name": "tail",
        "poseParent": "body",
        "pivot": [
          0,
          4.5,
          5
        ]
      }
    ]
  },
  "baby_sheep": {
    "id": "baby_sheep",
    "textureSize": [
      32,
      32
    ],
    "cubes": [
      {
        "origin": [
          -2.5,
          8,
          -6
        ],
        "size": [
          5,
          5,
          5
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "pivot": [
          0,
          8.5,
          -2.5
        ]
      },
      {
        "origin": [
          -2.975,
          0,
          2
        ],
        "size": [
          2,
          5,
          2
        ],
        "uv": [
          0,
          23
        ],
        "name": "leg0",
        "pivot": [
          -2,
          5,
          3
        ]
      },
      {
        "origin": [
          0.975,
          0,
          2
        ],
        "size": [
          2,
          5,
          2
        ],
        "uv": [
          24,
          12
        ],
        "name": "leg1",
        "pivot": [
          2,
          5,
          3
        ]
      },
      {
        "origin": [
          -2.975,
          0,
          -3
        ],
        "size": [
          2,
          5,
          2
        ],
        "uv": [
          8,
          23
        ],
        "name": "leg2",
        "pivot": [
          -2,
          5,
          -2
        ]
      },
      {
        "origin": [
          0.975,
          0,
          -3
        ],
        "size": [
          2,
          5,
          2
        ],
        "uv": [
          24,
          5
        ],
        "name": "leg3",
        "pivot": [
          2,
          5,
          -2
        ]
      },
      {
        "origin": [
          -3,
          5,
          -4
        ],
        "size": [
          6,
          4,
          9
        ],
        "uv": [
          0,
          10
        ],
        "name": "body",
        "pivot": [
          0,
          8,
          2.5
        ]
      }
    ]
  },
  "baby_zombie": {
    "id": "baby_zombie",
    "textureSize": [
      64,
      64
    ],
    "cubes": [
      {
        "origin": [
          -2,
          4,
          -1
        ],
        "size": [
          4,
          5,
          2
        ],
        "uv": [
          16,
          16
        ],
        "name": "body",
        "pivot": [
          0,
          6.5,
          0
        ]
      },
      {
        "origin": [
          -3,
          9,
          -3
        ],
        "size": [
          6,
          6,
          6
        ],
        "uv": [
          3,
          3
        ],
        "name": "head",
        "poseParent": "body",
        "pivot": [
          0,
          8.75,
          0
        ]
      },
      {
        "origin": [
          -3,
          8.9,
          -3
        ],
        "size": [
          6,
          6,
          6
        ],
        "uv": [
          35,
          3
        ],
        "name": "head",
        "poseParent": "body",
        "inflate": 0.25,
        "pivot": [
          0,
          8.75,
          0
        ]
      },
      {
        "origin": [
          -4,
          4,
          -1
        ],
        "size": [
          2,
          5,
          2
        ],
        "uv": [
          36,
          16
        ],
        "name": "right_arm",
        "poseParent": "body",
        "pivot": [
          -3,
          8.5,
          0
        ]
      },
      {
        "origin": [
          2,
          4,
          -1
        ],
        "size": [
          2,
          5,
          2
        ],
        "uv": [
          28,
          16
        ],
        "name": "left_arm",
        "poseParent": "body",
        "pivot": [
          3,
          8.5,
          0
        ]
      },
      {
        "origin": [
          -2,
          0,
          -1
        ],
        "size": [
          2,
          4,
          2
        ],
        "uv": [
          8,
          16
        ],
        "name": "right_leg",
        "poseParent": "body",
        "pivot": [
          -1,
          4,
          0
        ]
      },
      {
        "origin": [
          0,
          0,
          -1
        ],
        "size": [
          2,
          4,
          2
        ],
        "uv": [
          0,
          16
        ],
        "name": "left_leg",
        "poseParent": "body",
        "pivot": [
          1,
          4,
          0
        ]
      }
    ]
  },
  "baby_husk": {
    "id": "baby_husk",
    "textureSize": [
      64,
      64
    ],
    "cubes": [
      {
        "origin": [
          -2,
          4,
          -1
        ],
        "size": [
          4,
          5,
          2
        ],
        "uv": [
          16,
          16
        ],
        "name": "body",
        "pivot": [
          0,
          6.5,
          0
        ]
      },
      {
        "origin": [
          -3,
          9,
          -3
        ],
        "size": [
          6,
          6,
          6
        ],
        "uv": [
          3,
          3
        ],
        "name": "head",
        "poseParent": "body",
        "pivot": [
          0,
          8.75,
          0
        ]
      },
      {
        "origin": [
          -3,
          8.9,
          -3
        ],
        "size": [
          6,
          6,
          6
        ],
        "uv": [
          35,
          3
        ],
        "name": "head",
        "poseParent": "body",
        "inflate": 0.25,
        "pivot": [
          0,
          8.75,
          0
        ]
      },
      {
        "origin": [
          -4,
          4,
          -1
        ],
        "size": [
          2,
          5,
          2
        ],
        "uv": [
          36,
          16
        ],
        "name": "right_arm",
        "poseParent": "body",
        "pivot": [
          -3,
          8.5,
          0
        ]
      },
      {
        "origin": [
          2,
          4,
          -1
        ],
        "size": [
          2,
          5,
          2
        ],
        "uv": [
          28,
          16
        ],
        "name": "left_arm",
        "poseParent": "body",
        "pivot": [
          3,
          8.5,
          0
        ]
      },
      {
        "origin": [
          -2,
          0,
          -1
        ],
        "size": [
          2,
          4,
          2
        ],
        "uv": [
          8,
          16
        ],
        "name": "right_leg",
        "poseParent": "body",
        "pivot": [
          -1,
          4,
          0
        ]
      },
      {
        "origin": [
          0,
          0,
          -1
        ],
        "size": [
          2,
          4,
          2
        ],
        "uv": [
          0,
          16
        ],
        "name": "left_leg",
        "poseParent": "body",
        "pivot": [
          1,
          4,
          0
        ]
      }
    ]
  },
  "baby_drowned": {
    "id": "baby_drowned",
    "textureSize": [
      64,
      64
    ],
    "cubes": [
      {
        "origin": [
          -2,
          4,
          -1
        ],
        "size": [
          4,
          5,
          2
        ],
        "uv": [
          16,
          16
        ],
        "name": "body",
        "pivot": [
          0,
          6.5,
          0
        ]
      },
      {
        "origin": [
          -3,
          9,
          -3
        ],
        "size": [
          6,
          6,
          6
        ],
        "uv": [
          3,
          3
        ],
        "name": "head",
        "poseParent": "body",
        "pivot": [
          0,
          8.75,
          0
        ]
      },
      {
        "origin": [
          -3,
          8.9,
          -3
        ],
        "size": [
          6,
          6,
          6
        ],
        "uv": [
          35,
          3
        ],
        "name": "head",
        "poseParent": "body",
        "inflate": 0.25,
        "pivot": [
          0,
          8.75,
          0
        ]
      },
      {
        "origin": [
          -4,
          4,
          -1
        ],
        "size": [
          2,
          5,
          2
        ],
        "uv": [
          36,
          16
        ],
        "name": "right_arm",
        "poseParent": "body",
        "pivot": [
          -3,
          8.5,
          0
        ]
      },
      {
        "origin": [
          2,
          4,
          -1
        ],
        "size": [
          2,
          5,
          2
        ],
        "uv": [
          28,
          16
        ],
        "name": "left_arm",
        "poseParent": "body",
        "pivot": [
          3,
          8.5,
          0
        ]
      },
      {
        "origin": [
          -2,
          0,
          -1
        ],
        "size": [
          2,
          4,
          2
        ],
        "uv": [
          8,
          16
        ],
        "name": "right_leg",
        "poseParent": "body",
        "pivot": [
          -1,
          4,
          0
        ]
      },
      {
        "origin": [
          0,
          0,
          -1
        ],
        "size": [
          2,
          4,
          2
        ],
        "uv": [
          0,
          16
        ],
        "name": "left_leg",
        "poseParent": "body",
        "pivot": [
          1,
          4,
          0
        ]
      }
    ]
  },
  "baby_zombie_villager": {
    "id": "baby_zombie_villager",
    "textureSize": [
      64,
      64
    ],
    "cubes": [
      {
        "origin": [
          -2,
          3,
          -1.5
        ],
        "size": [
          4,
          5,
          3
        ],
        "uv": [
          0,
          15
        ],
        "name": "body",
        "poseParent": "waist",
        "pivot": [
          0,
          5.25,
          0
        ]
      },
      {
        "origin": [
          -2,
          2,
          -1.5
        ],
        "size": [
          4,
          6,
          3
        ],
        "uv": [
          16,
          22
        ],
        "name": "body",
        "poseParent": "waist",
        "inflate": 0.2,
        "pivot": [
          0,
          5.25,
          0
        ]
      },
      {
        "origin": [
          -4,
          8,
          -3.5
        ],
        "size": [
          8,
          8,
          7
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "poseParent": "waist",
        "pivot": [
          0,
          8,
          0
        ]
      },
      {
        "origin": [
          -4,
          8,
          -3.5
        ],
        "size": [
          8,
          8,
          7
        ],
        "uv": [
          0,
          31
        ],
        "name": "helmet",
        "poseParent": "head",
        "inflate": 0.3,
        "pivot": [
          0,
          12,
          0
        ]
      },
      {
        "origin": [
          -7,
          12,
          -6
        ],
        "size": [
          14,
          1,
          12
        ],
        "uv": [
          0,
          46
        ],
        "name": "brim",
        "poseParent": "head",
        "pivot": [
          0,
          12.5,
          0
        ]
      },
      {
        "origin": [
          -1,
          8,
          -4.5
        ],
        "size": [
          2,
          2,
          1
        ],
        "uv": [
          23,
          0
        ],
        "name": "nose",
        "poseParent": "head",
        "pivot": [
          0,
          9,
          -4
        ]
      },
      {
        "origin": [
          -4,
          2.75,
          -1
        ],
        "size": [
          2,
          5,
          2
        ],
        "uv": [
          24,
          15
        ],
        "name": "right_arm",
        "poseParent": "waist",
        "pivot": [
          -3,
          7.75,
          0
        ]
      },
      {
        "origin": [
          2,
          2.75,
          -1
        ],
        "size": [
          2,
          5,
          2
        ],
        "uv": [
          16,
          15
        ],
        "name": "left_arm",
        "poseParent": "waist",
        "pivot": [
          3,
          7.75,
          0
        ]
      },
      {
        "origin": [
          -2,
          0,
          -1
        ],
        "size": [
          2,
          3,
          2
        ],
        "uv": [
          8,
          23
        ],
        "name": "right_leg",
        "poseParent": "waist",
        "pivot": [
          -1,
          2.5,
          0
        ]
      },
      {
        "origin": [
          0,
          0,
          -1
        ],
        "size": [
          2,
          3,
          2
        ],
        "uv": [
          0,
          23
        ],
        "name": "left_leg",
        "poseParent": "waist",
        "pivot": [
          1,
          2.5,
          0
        ]
      }
    ]
  },
  "baby_piglin": {
    "id": "baby_piglin",
    "textureSize": [
      64,
      64
    ],
    "cubes": [
      {
        "origin": [
          -3,
          4,
          -1
        ],
        "size": [
          6,
          5,
          3
        ],
        "uv": [
          0,
          13
        ],
        "name": "body",
        "pivot": [
          0,
          6,
          0
        ]
      },
      {
        "origin": [
          -1.5,
          9,
          -4
        ],
        "size": [
          3,
          3,
          1
        ],
        "uv": [
          21,
          30
        ],
        "name": "head",
        "poseParent": "body",
        "pivot": [
          0,
          9,
          0.5
        ]
      },
      {
        "origin": [
          -4.5,
          9,
          -3
        ],
        "size": [
          9,
          6,
          7
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "poseParent": "body",
        "pivot": [
          0,
          9,
          0.5
        ]
      },
      {
        "origin": [
          4.7,
          8.25,
          -1
        ],
        "size": [
          1,
          6,
          4
        ],
        "uv": [
          0,
          21
        ],
        "name": "leftear",
        "poseParent": "head",
        "pivot": [
          5.2,
          11.25,
          1
        ],
        "rotation": [
          0,
          0,
          35
        ]
      },
      {
        "origin": [
          -5.7,
          8.25,
          -1
        ],
        "size": [
          1,
          6,
          4
        ],
        "uv": [
          18,
          13
        ],
        "name": "rightear",
        "poseParent": "head",
        "pivot": [
          -5.2,
          11.25,
          1
        ],
        "rotation": [
          0,
          0,
          -35
        ]
      },
      {
        "origin": [
          3,
          4,
          -1
        ],
        "size": [
          2,
          5,
          3
        ],
        "uv": [
          28,
          13
        ],
        "name": "left_arm",
        "poseParent": "body",
        "pivot": [
          4,
          9,
          0.5
        ]
      },
      {
        "origin": [
          -5,
          4,
          -1
        ],
        "size": [
          2,
          5,
          3
        ],
        "uv": [
          10,
          30
        ],
        "name": "right_arm",
        "poseParent": "body",
        "pivot": [
          -4,
          9,
          0.5
        ]
      },
      {
        "origin": [
          -3,
          0,
          -1
        ],
        "size": [
          3,
          4,
          3
        ],
        "uv": [
          22,
          23
        ],
        "name": "right_leg",
        "poseParent": "body",
        "pivot": [
          -1.5,
          4,
          0.5
        ]
      },
      {
        "origin": [
          0,
          0,
          -1
        ],
        "size": [
          3,
          4,
          3
        ],
        "uv": [
          10,
          23
        ],
        "name": "left_leg",
        "poseParent": "body",
        "pivot": [
          1.5,
          4,
          0.5
        ]
      }
    ]
  },
  "baby_zombified_piglin": {
    "id": "baby_zombified_piglin",
    "textureSize": [
      64,
      64
    ],
    "cubes": [
      {
        "origin": [
          -3,
          4,
          -1
        ],
        "size": [
          6,
          5,
          3
        ],
        "uv": [
          0,
          13
        ],
        "name": "body",
        "pivot": [
          0,
          6,
          0
        ]
      },
      {
        "origin": [
          -1.5,
          9,
          -4
        ],
        "size": [
          3,
          3,
          1
        ],
        "uv": [
          21,
          30
        ],
        "name": "head",
        "poseParent": "body",
        "pivot": [
          0,
          9,
          0.5
        ]
      },
      {
        "origin": [
          -4.5,
          9,
          -3
        ],
        "size": [
          9,
          6,
          7
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "poseParent": "body",
        "pivot": [
          0,
          9,
          0.5
        ]
      },
      {
        "origin": [
          4.7,
          8.25,
          -1
        ],
        "size": [
          1,
          6,
          4
        ],
        "uv": [
          0,
          21
        ],
        "name": "leftear",
        "poseParent": "head",
        "pivot": [
          5.2,
          11.25,
          1
        ],
        "rotation": [
          0,
          0,
          35
        ]
      },
      {
        "origin": [
          -5.7,
          8.25,
          -1
        ],
        "size": [
          1,
          6,
          4
        ],
        "uv": [
          18,
          13
        ],
        "name": "rightear",
        "poseParent": "head",
        "pivot": [
          -5.2,
          11.25,
          1
        ],
        "rotation": [
          0,
          0,
          -35
        ]
      },
      {
        "origin": [
          3,
          4,
          -1
        ],
        "size": [
          2,
          5,
          3
        ],
        "uv": [
          28,
          13
        ],
        "name": "left_arm",
        "poseParent": "body",
        "pivot": [
          4,
          9,
          0.5
        ]
      },
      {
        "origin": [
          -5,
          4,
          -1
        ],
        "size": [
          2,
          5,
          3
        ],
        "uv": [
          10,
          30
        ],
        "name": "right_arm",
        "poseParent": "body",
        "pivot": [
          -4,
          9,
          0.5
        ]
      },
      {
        "origin": [
          -3,
          0,
          -1
        ],
        "size": [
          3,
          4,
          3
        ],
        "uv": [
          22,
          23
        ],
        "name": "right_leg",
        "poseParent": "body",
        "pivot": [
          -1.5,
          4,
          0.5
        ]
      },
      {
        "origin": [
          0,
          0,
          -1
        ],
        "size": [
          3,
          4,
          3
        ],
        "uv": [
          10,
          23
        ],
        "name": "left_leg",
        "poseParent": "body",
        "pivot": [
          1.5,
          4,
          0.5
        ]
      }
    ]
  },
  "baby_hoglin": {
    "id": "baby_hoglin",
    "textureSize": [
      64,
      64
    ],
    "cubes": [
      {
        "origin": [
          -4,
          6,
          -7
        ],
        "size": [
          8,
          8,
          14
        ],
        "uv": [
          0,
          16
        ],
        "name": "body",
        "inflate": 0.02,
        "pivot": [
          0,
          0,
          0
        ]
      },
      {
        "origin": [
          0,
          12,
          -8
        ],
        "size": [
          0,
          6,
          11
        ],
        "uv": [
          24,
          39
        ],
        "name": "body",
        "inflate": 0.02,
        "pivot": [
          0,
          0,
          0
        ]
      },
      {
        "origin": [
          -5,
          9.26,
          -17.547
        ],
        "size": [
          10,
          4,
          12
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "poseParent": "body",
        "pivot": [
          0,
          11,
          -7
        ],
        "rotation": [
          -50,
          0,
          0
        ]
      },
      {
        "origin": [
          -7,
          10.098,
          -15.488
        ],
        "size": [
          2,
          5,
          2
        ],
        "uv": [
          44,
          29
        ],
        "name": "head",
        "poseParent": "body",
        "pivot": [
          0,
          11,
          -7
        ],
        "rotation": [
          -50,
          0,
          0
        ]
      },
      {
        "origin": [
          5,
          10.098,
          -15.488
        ],
        "size": [
          2,
          5,
          2
        ],
        "uv": [
          52,
          29
        ],
        "name": "head",
        "poseParent": "body",
        "pivot": [
          0,
          11,
          -7
        ],
        "rotation": [
          -50,
          0,
          0
        ]
      },
      {
        "origin": [
          -10.1,
          11.5,
          -10.5
        ],
        "size": [
          6,
          1,
          4
        ],
        "uv": [
          32,
          5
        ],
        "name": "right_ear",
        "poseParent": "head",
        "pivot": [
          -5,
          12,
          -8.5
        ],
        "rotation": [
          0,
          0,
          50
        ],
        "parents": [
          {
            "pivot": [
              0,
              11,
              -7
            ],
            "rotation": [
              -50,
              0,
              0
            ]
          }
        ]
      },
      {
        "origin": [
          4.1,
          11.5,
          -10.5
        ],
        "size": [
          6,
          1,
          4
        ],
        "uv": [
          32,
          0
        ],
        "name": "left_ear",
        "poseParent": "head",
        "mirror": true,
        "pivot": [
          5,
          12,
          -8.5
        ],
        "rotation": [
          0,
          0,
          -50
        ],
        "parents": [
          {
            "pivot": [
              0,
              11,
              -7
            ],
            "rotation": [
              -50,
              0,
              0
            ]
          }
        ]
      },
      {
        "origin": [
          -4,
          0,
          3
        ],
        "size": [
          3,
          6,
          3
        ],
        "uv": [
          0,
          47
        ],
        "name": "leg_back_right",
        "poseParent": "body",
        "pivot": [
          -2.5,
          6,
          4.5
        ]
      },
      {
        "origin": [
          1,
          0,
          3
        ],
        "size": [
          3,
          6,
          3
        ],
        "uv": [
          12,
          47
        ],
        "name": "leg_back_left",
        "poseParent": "body",
        "pivot": [
          2.5,
          6,
          4.5
        ]
      },
      {
        "origin": [
          -4,
          0,
          -6
        ],
        "size": [
          3,
          6,
          3
        ],
        "uv": [
          0,
          38
        ],
        "name": "leg_front_right",
        "poseParent": "body",
        "pivot": [
          -2.5,
          6,
          -4.5
        ]
      },
      {
        "origin": [
          1,
          0,
          -6
        ],
        "size": [
          3,
          6,
          3
        ],
        "uv": [
          12,
          38
        ],
        "name": "leg_front_left",
        "poseParent": "body",
        "pivot": [
          2.5,
          6,
          -4.5
        ]
      }
    ]
  },
  "baby_panda": {
    "id": "baby_panda",
    "textureSize": [
      64,
      64
    ],
    "cubes": [
      {
        "origin": [
          -4.5,
          2,
          -3
        ],
        "size": [
          9,
          7,
          11
        ],
        "uv": [
          0,
          11
        ],
        "name": "body",
        "pivot": [
          0,
          5.5,
          2.5
        ]
      },
      {
        "origin": [
          -3.5,
          2,
          -8
        ],
        "size": [
          7,
          6,
          5
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "poseParent": "body",
        "pivot": [
          0,
          5,
          -3
        ]
      },
      {
        "origin": [
          -2,
          2,
          -9
        ],
        "size": [
          4,
          2,
          1
        ],
        "uv": [
          24,
          6
        ],
        "name": "head",
        "poseParent": "body",
        "pivot": [
          0,
          5,
          -3
        ]
      },
      {
        "origin": [
          -4.5,
          6,
          -6.5
        ],
        "size": [
          3,
          3,
          1
        ],
        "uv": [
          24,
          0
        ],
        "name": "head",
        "poseParent": "body",
        "pivot": [
          0,
          5,
          -3
        ]
      },
      {
        "origin": [
          1.5,
          6,
          -6.5
        ],
        "size": [
          3,
          3,
          1
        ],
        "uv": [
          33,
          0
        ],
        "name": "head",
        "poseParent": "body",
        "pivot": [
          0,
          5,
          -3
        ]
      },
      {
        "origin": [
          -4.497,
          0,
          4.975
        ],
        "size": [
          3,
          2,
          3
        ],
        "uv": [
          0,
          34
        ],
        "name": "leg0",
        "poseParent": "body",
        "pivot": [
          -3,
          2,
          6.5
        ]
      },
      {
        "origin": [
          1.498,
          0,
          4.975
        ],
        "size": [
          3,
          2,
          3
        ],
        "uv": [
          12,
          34
        ],
        "name": "leg1",
        "poseParent": "body",
        "pivot": [
          3,
          2,
          6.5
        ]
      },
      {
        "origin": [
          -4.475,
          0,
          -2.975
        ],
        "size": [
          3,
          2,
          3
        ],
        "uv": [
          0,
          29
        ],
        "name": "leg2",
        "poseParent": "body",
        "pivot": [
          -3,
          2,
          -1.5
        ]
      },
      {
        "origin": [
          1.475,
          0,
          -2.975
        ],
        "size": [
          3,
          2,
          3
        ],
        "uv": [
          12,
          29
        ],
        "name": "leg3",
        "poseParent": "body",
        "pivot": [
          3,
          2,
          -1.5
        ]
      }
    ]
  },
  "baby_llama": {
    "id": "baby_llama",
    "textureSize": [
      64,
      64
    ],
    "cubes": [
      {
        "origin": [
          -3,
          11,
          -8
        ],
        "size": [
          6,
          11,
          4
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "pivot": [
          0,
          13,
          -4
        ]
      },
      {
        "origin": [
          -1.5,
          17,
          -11
        ],
        "size": [
          3,
          3,
          3
        ],
        "uv": [
          0,
          15
        ],
        "name": "head",
        "pivot": [
          0,
          13,
          -4
        ]
      },
      {
        "origin": [
          0.5,
          22,
          -7
        ],
        "size": [
          2,
          2,
          2
        ],
        "uv": [
          20,
          4
        ],
        "name": "head",
        "pivot": [
          0,
          13,
          -4
        ]
      },
      {
        "origin": [
          -2.5,
          22,
          -7
        ],
        "size": [
          2,
          2,
          2
        ],
        "uv": [
          20,
          0
        ],
        "name": "head",
        "pivot": [
          0,
          13,
          -4
        ]
      },
      {
        "origin": [
          -3.9,
          0,
          3
        ],
        "size": [
          3,
          8,
          3
        ],
        "uv": [
          0,
          45
        ],
        "name": "leg0",
        "pivot": [
          -2.5,
          8.5,
          4.5
        ]
      },
      {
        "origin": [
          0.9,
          0,
          3
        ],
        "size": [
          3,
          8,
          3
        ],
        "uv": [
          12,
          45
        ],
        "name": "leg1",
        "pivot": [
          2.5,
          8.5,
          4.5
        ]
      },
      {
        "origin": [
          -3.9,
          0,
          -5
        ],
        "size": [
          3,
          8,
          3
        ],
        "uv": [
          0,
          34
        ],
        "name": "leg2",
        "pivot": [
          -2.5,
          8.5,
          -3.5
        ]
      },
      {
        "origin": [
          0.9,
          0,
          -5
        ],
        "size": [
          3,
          8,
          3
        ],
        "uv": [
          12,
          34
        ],
        "name": "leg3",
        "pivot": [
          2.5,
          8.5,
          -3.5
        ]
      },
      {
        "origin": [
          -4,
          8,
          -6
        ],
        "size": [
          8,
          6,
          13
        ],
        "uv": [
          0,
          15
        ],
        "name": "body",
        "pivot": [
          0,
          11,
          2.5
        ]
      }
    ]
  },
  "baby_rabbit": {
    "id": "baby_rabbit",
    "textureSize": [
      32,
      32
    ],
    "cubes": [
      {
        "origin": [
          -2,
          2,
          -3
        ],
        "size": [
          4,
          3,
          6
        ],
        "uv": [
          0,
          8
        ],
        "name": "body",
        "pivot": [
          0,
          3,
          0
        ],
        "rotation": [
          30,
          0,
          0
        ]
      },
      {
        "origin": [
          -1.5,
          2.227,
          2.582
        ],
        "size": [
          3,
          3,
          3
        ],
        "uv": [
          0,
          21
        ],
        "name": "tail",
        "poseParent": "body",
        "pivot": [
          -0.1,
          3.2,
          3.6
        ],
        "rotation": [
          30,
          0,
          0
        ]
      },
      {
        "origin": [
          -2.5,
          5,
          -4
        ],
        "size": [
          5,
          4,
          4
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "poseParent": "body",
        "pivot": [
          0,
          6,
          -1
        ]
      },
      {
        "origin": [
          -2.5,
          9,
          -2
        ],
        "size": [
          2,
          4,
          1
        ],
        "uv": [
          18,
          0
        ],
        "name": "right_ear",
        "poseParent": "head",
        "pivot": [
          -1.5,
          9.5,
          -1.5
        ]
      },
      {
        "origin": [
          0.5,
          9,
          -2
        ],
        "size": [
          2,
          4,
          1
        ],
        "uv": [
          24,
          0
        ],
        "name": "left_ear",
        "poseParent": "head",
        "pivot": [
          1.5,
          9.5,
          -1.5
        ]
      },
      {
        "origin": [
          0.5,
          0,
          -2
        ],
        "size": [
          1,
          3,
          1
        ],
        "uv": [
          18,
          8
        ],
        "name": "left_front_leg",
        "poseParent": "frontlegs",
        "pivot": [
          1,
          1.5,
          -1.5
        ],
        "rotation": [
          22.5,
          0,
          0
        ],
        "parents": [
          {
            "pivot": [
              1,
              2.5,
              -1.5
            ],
            "rotation": [
              -22.5,
              0,
              0
            ]
          }
        ]
      },
      {
        "origin": [
          -1.5,
          0,
          -2
        ],
        "size": [
          1,
          3,
          1
        ],
        "uv": [
          14,
          8
        ],
        "name": "right_front_leg",
        "poseParent": "frontlegs",
        "pivot": [
          -1,
          1.5,
          -1.5
        ],
        "rotation": [
          22.5,
          0,
          0
        ],
        "parents": [
          {
            "pivot": [
              -1,
              2.5,
              -1.5
            ],
            "rotation": [
              -22.5,
              0,
              0
            ]
          }
        ]
      },
      {
        "origin": [
          0.5,
          0,
          3
        ],
        "size": [
          2,
          1,
          3
        ],
        "uv": [
          10,
          17
        ],
        "name": "left_back_leg",
        "poseParent": "backlegs",
        "pivot": [
          2.5,
          0.5,
          3
        ],
        "rotation": [
          0,
          45,
          0
        ],
        "parents": [
          {
            "pivot": [
              1.5,
              0.5,
              2.5
            ],
            "rotation": [
              0,
              -180,
              0
            ]
          }
        ]
      },
      {
        "origin": [
          -3,
          0,
          1.6
        ],
        "size": [
          2,
          1,
          3
        ],
        "uv": [
          0,
          17
        ],
        "name": "right_back_leg",
        "poseParent": "backlegs",
        "pivot": [
          -1,
          0.5,
          1.6
        ],
        "rotation": [
          0,
          -45,
          0
        ],
        "parents": [
          {
            "pivot": [
              -1.5,
              0.5,
              2.5
            ],
            "rotation": [
              0,
              -180,
              0
            ]
          }
        ]
      }
    ]
  },
  "baby_turtle": {
    "id": "baby_turtle",
    "textureSize": [
      16,
      16
    ],
    "cubes": [
      {
        "origin": [
          -2,
          0,
          -1
        ],
        "size": [
          4,
          2,
          4
        ],
        "uv": [
          0,
          0
        ],
        "name": "body",
        "pivot": [
          0,
          1,
          1
        ]
      },
      {
        "origin": [
          -1.5,
          0,
          -4
        ],
        "size": [
          3,
          3,
          3
        ],
        "uv": [
          0,
          6
        ],
        "name": "head",
        "pivot": [
          0,
          1,
          -1
        ]
      },
      {
        "origin": [
          -4,
          0,
          2
        ],
        "size": [
          2,
          0,
          1
        ],
        "uv": [
          -1,
          0
        ],
        "name": "leg0",
        "pivot": [
          -2,
          0,
          2.5
        ]
      },
      {
        "origin": [
          2,
          0,
          2
        ],
        "size": [
          2,
          0,
          1
        ],
        "uv": [
          -1,
          1
        ],
        "name": "leg1",
        "pivot": [
          2,
          0,
          2.5
        ]
      },
      {
        "origin": [
          -4,
          0,
          -1
        ],
        "size": [
          2,
          0,
          1
        ],
        "uv": [
          8,
          6
        ],
        "name": "leg2",
        "pivot": [
          -2,
          0,
          -0.5
        ]
      },
      {
        "origin": [
          2,
          0,
          -1
        ],
        "size": [
          2,
          0,
          1
        ],
        "uv": [
          8,
          7
        ],
        "name": "leg3",
        "pivot": [
          2,
          0,
          -0.5
        ]
      }
    ]
  },
  "baby_bee": {
    "id": "baby_bee",
    "textureSize": [
      32,
      32
    ],
    "cubes": [
      {
        "origin": [
          -2,
          1,
          -2
        ],
        "size": [
          4,
          4,
          5
        ],
        "uv": [
          0,
          0
        ],
        "name": "body",
        "pivot": [
          0,
          4.333,
          -1.857
        ]
      },
      {
        "origin": [
          1,
          4,
          -4.02
        ],
        "size": [
          1,
          2,
          2
        ],
        "uv": [
          6,
          12
        ],
        "name": "body",
        "pivot": [
          0,
          4.333,
          -1.857
        ]
      },
      {
        "origin": [
          -2,
          4,
          -4.05
        ],
        "size": [
          1,
          2,
          2
        ],
        "uv": [
          0,
          12
        ],
        "name": "body",
        "pivot": [
          0,
          4.333,
          -1.857
        ]
      },
      {
        "origin": [
          0,
          2,
          3
        ],
        "size": [
          0,
          1,
          1
        ],
        "uv": [
          13,
          2
        ],
        "name": "stinger",
        "poseParent": "body",
        "pivot": [
          0,
          2.5,
          3
        ]
      },
      {
        "origin": [
          -4,
          5,
          -1
        ],
        "size": [
          3,
          0,
          3
        ],
        "uv": [
          3,
          9
        ],
        "name": "rightwing_bone",
        "poseParent": "body",
        "pivot": [
          -1,
          5,
          -1
        ],
        "rotation": [
          -12.5,
          -20,
          0
        ]
      },
      {
        "origin": [
          1,
          5,
          -1
        ],
        "size": [
          3,
          0,
          3
        ],
        "uv": [
          -3,
          9
        ],
        "name": "leftwing_bone",
        "poseParent": "body",
        "mirror": true,
        "pivot": [
          1,
          5,
          -1
        ],
        "rotation": [
          -12.5,
          20,
          0
        ]
      },
      {
        "origin": [
          -1.5,
          0,
          0
        ],
        "size": [
          3,
          1,
          0
        ],
        "uv": [
          13,
          0
        ],
        "name": "leg_front",
        "poseParent": "body",
        "pivot": [
          0,
          1,
          0
        ]
      },
      {
        "origin": [
          -1.5,
          0,
          1
        ],
        "size": [
          3,
          1,
          0
        ],
        "uv": [
          13,
          1
        ],
        "name": "leg_mid",
        "poseParent": "body",
        "pivot": [
          0,
          1,
          1
        ]
      },
      {
        "origin": [
          -1.5,
          0,
          2
        ],
        "size": [
          3,
          1,
          0
        ],
        "uv": [
          13,
          2
        ],
        "name": "leg_back",
        "poseParent": "body",
        "pivot": [
          0,
          1,
          2
        ]
      }
    ]
  },
  "baby_polar_bear": {
    "id": "baby_polar_bear",
    "textureSize": [
      64,
      64
    ],
    "cubes": [
      {
        "origin": [
          -3,
          3,
          -10
        ],
        "size": [
          6,
          5,
          4
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "pivot": [
          0,
          5.375,
          -6.75
        ]
      },
      {
        "origin": [
          -2,
          3,
          -12
        ],
        "size": [
          4,
          2,
          2
        ],
        "uv": [
          20,
          3
        ],
        "name": "head",
        "pivot": [
          0,
          5.375,
          -6.75
        ]
      },
      {
        "origin": [
          -4,
          7,
          -8.5
        ],
        "size": [
          2,
          2,
          1
        ],
        "uv": [
          20,
          0
        ],
        "name": "head",
        "pivot": [
          0,
          5.375,
          -6.75
        ]
      },
      {
        "origin": [
          2,
          7,
          -8.5
        ],
        "size": [
          2,
          2,
          1
        ],
        "uv": [
          26,
          0
        ],
        "name": "head",
        "pivot": [
          0,
          5.375,
          -6.75
        ]
      },
      {
        "origin": [
          -3.975,
          0,
          3
        ],
        "size": [
          3,
          3,
          3
        ],
        "uv": [
          0,
          34
        ],
        "name": "leg0",
        "pivot": [
          -2.5,
          2.5,
          4.5
        ]
      },
      {
        "origin": [
          0.975,
          0,
          3
        ],
        "size": [
          3,
          3,
          3
        ],
        "uv": [
          12,
          34
        ],
        "name": "leg1",
        "pivot": [
          2.5,
          2.5,
          4.5
        ]
      },
      {
        "origin": [
          -3.975,
          0,
          -6
        ],
        "size": [
          3,
          3,
          3
        ],
        "uv": [
          0,
          28
        ],
        "name": "leg2",
        "pivot": [
          -2.5,
          2.5,
          -4.5
        ]
      },
      {
        "origin": [
          0.975,
          0,
          -6
        ],
        "size": [
          3,
          3,
          3
        ],
        "uv": [
          12,
          28
        ],
        "name": "leg3",
        "pivot": [
          2.5,
          2.5,
          -4.5
        ]
      },
      {
        "origin": [
          -4,
          3,
          -6
        ],
        "size": [
          8,
          7,
          12
        ],
        "uv": [
          0,
          9
        ],
        "name": "body",
        "pivot": [
          0,
          6.5,
          4
        ]
      }
    ]
  }
,
  "ender_dragon": {
    "id": "ender_dragon",
    "textureSize": [
      256,
      256
    ],
    "cubes": [
      {
        "origin": [
          -6,
          20,
          -24
        ],
        "size": [
          12,
          5,
          16
        ],
        "uv": [
          176,
          44
        ],
        "name": "head",
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          -8,
          16,
          -10
        ],
        "size": [
          16,
          16,
          16
        ],
        "uv": [
          112,
          30
        ],
        "name": "head",
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          -5,
          32,
          -4
        ],
        "size": [
          2,
          4,
          6
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "mirror": true,
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          -5,
          25,
          -22
        ],
        "size": [
          2,
          2,
          4
        ],
        "uv": [
          112,
          0
        ],
        "name": "head",
        "mirror": true,
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          3,
          32,
          -4
        ],
        "size": [
          2,
          4,
          6
        ],
        "uv": [
          0,
          0
        ],
        "name": "head",
        "mirror": true,
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          3,
          25,
          -22
        ],
        "size": [
          2,
          2,
          4
        ],
        "uv": [
          112,
          0
        ],
        "name": "head",
        "mirror": true,
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          -6,
          16,
          -24
        ],
        "size": [
          12,
          4,
          16
        ],
        "uv": [
          176,
          65
        ],
        "name": "jaw",
        "poseParent": "head",
        "pivot": [
          0,
          20,
          -8
        ]
      },
      {
        "origin": [
          -16,
          -16,
          -2
        ],
        "size": [
          8,
          24,
          8
        ],
        "uv": [
          112,
          104
        ],
        "name": "right_front_leg",
        "pivot": [
          -12,
          4,
          2
        ]
      },
      {
        "origin": [
          -15,
          -39,
          -2
        ],
        "size": [
          6,
          24,
          6
        ],
        "uv": [
          226,
          138
        ],
        "name": "right_front_leg_tip",
        "poseParent": "right_front_leg",
        "pivot": [
          -12,
          -16,
          1
        ]
      },
      {
        "origin": [
          -16,
          -43,
          -11
        ],
        "size": [
          8,
          4,
          16
        ],
        "uv": [
          144,
          104
        ],
        "name": "right_front_foot",
        "poseParent": "right_front_leg_tip",
        "pivot": [
          -12,
          -39,
          1
        ]
      },
      {
        "origin": [
          -24,
          -20,
          34
        ],
        "size": [
          16,
          32,
          16
        ],
        "uv": [
          0,
          0
        ],
        "name": "right_hind_leg",
        "pivot": [
          -16,
          8,
          42
        ]
      },
      {
        "origin": [
          -22,
          -54,
          38
        ],
        "size": [
          12,
          32,
          12
        ],
        "uv": [
          196,
          0
        ],
        "name": "right_hind_leg_tip",
        "poseParent": "right_hind_leg",
        "pivot": [
          -16,
          -24,
          38
        ]
      },
      {
        "origin": [
          -25,
          -61,
          22
        ],
        "size": [
          18,
          6,
          24
        ],
        "uv": [
          112,
          0
        ],
        "name": "right_hind_foot",
        "poseParent": "right_hind_leg_tip",
        "pivot": [
          -16,
          -55,
          42
        ]
      },
      {
        "origin": [
          -68,
          15,
          -2
        ],
        "size": [
          56,
          8,
          8
        ],
        "uv": [
          112,
          88
        ],
        "name": "right_wing",
        "pivot": [
          -12,
          19,
          2
        ]
      },
      {
        "origin": [
          -68,
          19,
          4
        ],
        "size": [
          56,
          0,
          56
        ],
        "uv": [
          -56,
          88
        ],
        "name": "right_wing",
        "pivot": [
          -12,
          19,
          2
        ]
      },
      {
        "origin": [
          -124,
          17,
          0
        ],
        "size": [
          56,
          4,
          4
        ],
        "uv": [
          112,
          136
        ],
        "name": "right_wing_tip",
        "poseParent": "right_wing",
        "pivot": [
          -68,
          19,
          2
        ]
      },
      {
        "origin": [
          -124,
          19,
          4
        ],
        "size": [
          56,
          0,
          56
        ],
        "uv": [
          -56,
          144
        ],
        "name": "right_wing_tip",
        "poseParent": "right_wing",
        "pivot": [
          -68,
          19,
          2
        ]
      },
      {
        "origin": [
          12,
          15,
          -2
        ],
        "size": [
          56,
          8,
          8
        ],
        "uv": [
          112,
          88
        ],
        "name": "left_wing",
        "mirror": true,
        "pivot": [
          12,
          19,
          2
        ]
      },
      {
        "origin": [
          12,
          19,
          4
        ],
        "size": [
          56,
          0,
          56
        ],
        "uv": [
          -56,
          88
        ],
        "name": "left_wing",
        "mirror": true,
        "pivot": [
          12,
          19,
          2
        ]
      },
      {
        "origin": [
          68,
          17,
          0
        ],
        "size": [
          56,
          4,
          4
        ],
        "uv": [
          112,
          136
        ],
        "name": "left_wing_tip",
        "poseParent": "left_wing",
        "mirror": true,
        "pivot": [
          68,
          19,
          2
        ]
      },
      {
        "origin": [
          68,
          19,
          4
        ],
        "size": [
          56,
          0,
          56
        ],
        "uv": [
          -56,
          144
        ],
        "name": "left_wing_tip",
        "poseParent": "left_wing",
        "mirror": true,
        "pivot": [
          68,
          19,
          2
        ]
      },
      {
        "origin": [
          8,
          -20,
          34
        ],
        "size": [
          16,
          32,
          16
        ],
        "uv": [
          0,
          0
        ],
        "name": "left_hind_leg",
        "pivot": [
          16,
          8,
          42
        ]
      },
      {
        "origin": [
          10,
          -54,
          38
        ],
        "size": [
          12,
          32,
          12
        ],
        "uv": [
          196,
          0
        ],
        "name": "left_hind_leg_tip",
        "poseParent": "left_hind_leg",
        "pivot": [
          16,
          -24,
          38
        ]
      },
      {
        "origin": [
          7,
          -61,
          22
        ],
        "size": [
          18,
          6,
          24
        ],
        "uv": [
          112,
          0
        ],
        "name": "left_hind_foot",
        "poseParent": "left_hind_leg_tip",
        "pivot": [
          16,
          -55,
          42
        ]
      },
      {
        "origin": [
          -5,
          19,
          -5
        ],
        "size": [
          10,
          10,
          10
        ],
        "uv": [
          192,
          104
        ],
        "name": "neck",
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          -1,
          29,
          -3
        ],
        "size": [
          2,
          4,
          6
        ],
        "uv": [
          48,
          0
        ],
        "name": "neck",
        "pivot": [
          0,
          24,
          0
        ]
      },
      {
        "origin": [
          -12,
          -4,
          -8
        ],
        "size": [
          24,
          24,
          64
        ],
        "uv": [
          0,
          0
        ],
        "name": "body",
        "pivot": [
          0,
          20,
          8
        ]
      },
      {
        "origin": [
          -1,
          20,
          -2
        ],
        "size": [
          2,
          6,
          12
        ],
        "uv": [
          220,
          53
        ],
        "name": "body",
        "pivot": [
          0,
          20,
          8
        ]
      },
      {
        "origin": [
          -1,
          20,
          18
        ],
        "size": [
          2,
          6,
          12
        ],
        "uv": [
          220,
          53
        ],
        "name": "body",
        "pivot": [
          0,
          20,
          8
        ]
      },
      {
        "origin": [
          -1,
          20,
          38
        ],
        "size": [
          2,
          6,
          12
        ],
        "uv": [
          220,
          53
        ],
        "name": "body",
        "pivot": [
          0,
          20,
          8
        ]
      },
      {
        "origin": [
          8,
          -16,
          -2
        ],
        "size": [
          8,
          24,
          8
        ],
        "uv": [
          112,
          104
        ],
        "name": "left_front_leg",
        "pivot": [
          12,
          4,
          2
        ]
      },
      {
        "origin": [
          9,
          -39,
          -2
        ],
        "size": [
          6,
          24,
          6
        ],
        "uv": [
          226,
          138
        ],
        "name": "left_front_leg_tip",
        "poseParent": "left_front_leg",
        "pivot": [
          12,
          -16,
          1
        ]
      },
      {
        "origin": [
          8,
          -43,
          -11
        ],
        "size": [
          8,
          4,
          16
        ],
        "uv": [
          144,
          104
        ],
        "name": "left_front_foot",
        "poseParent": "left_front_leg_tip",
        "pivot": [
          12,
          -39,
          1
        ]
      }
    ]
  },
  "shulker": {
    "id": "shulker",
    "textureSize": [
      64,
      64
    ],
    "cubes": [
      {
        "origin": [
          -3,
          6,
          -3
        ],
        "size": [
          6,
          6,
          6
        ],
        "uv": [
          0,
          52
        ],
        "name": "head",
        "pivot": [
          0,
          12,
          0
        ]
      },
      {
        "origin": [
          -8,
          4,
          -8
        ],
        "size": [
          16,
          12,
          16
        ],
        "uv": [
          0,
          0
        ],
        "name": "lid",
        "pivot": [
          0,
          0,
          0
        ]
      },
      {
        "origin": [
          -8,
          0,
          -8
        ],
        "size": [
          16,
          8,
          16
        ],
        "uv": [
          0,
          28
        ],
        "name": "base",
        "pivot": [
          0,
          0,
          0
        ]
      }
    ]
  }
}
