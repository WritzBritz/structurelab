use serde::Serialize;

#[derive(Debug, Clone, Copy)]
pub struct VersionDef {
    pub id: &'static str,
    pub label: &'static str,
    pub data_version: i32,
}

/// Known Minecraft versions, newest first. Add entries here when palettes are extracted.
const VERSIONS: &[VersionDef] = &[
    VersionDef {
        id: "26.2",
        label: "26.2",
        data_version: 4903,
    },
    VersionDef {
        id: "26.1",
        label: "26.1",
        data_version: 4786,
    },
    VersionDef {
        id: "1.21.11",
        label: "1.21.11",
        data_version: 4671,
    },
    VersionDef {
        id: "1.21.6",
        label: "1.21.6",
        data_version: 4435,
    },
    VersionDef {
        id: "1.21.4",
        label: "1.21.4",
        data_version: 4189,
    },
    VersionDef {
        id: "1.21",
        label: "1.21",
        data_version: 3955,
    },
    VersionDef {
        id: "1.20.6",
        label: "1.20.6",
        data_version: 3839,
    },
    VersionDef {
        id: "1.20.4",
        label: "1.20.4",
        data_version: 3700,
    },
    VersionDef {
        id: "1.20",
        label: "1.20",
        data_version: 3463,
    },
];

#[cfg(test)]
pub fn registered_versions() -> &'static [VersionDef] {
    VERSIONS
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MinecraftVersionInfo {
    pub id: String,
    pub label: String,
    pub data_version: i32,
    pub available: bool,
}

pub fn default_version_id() -> &'static str {
    VERSIONS.first().map(|entry| entry.id).unwrap_or("26.2")
}

pub fn version_def(id: &str) -> Option<&'static VersionDef> {
    VERSIONS.iter().find(|entry| entry.id == id)
}

pub fn expected_data_version(id: &str) -> Option<i32> {
    version_def(id).map(|entry| entry.data_version)
}

/// Minecraft 1.20.5 (`DataVersion` 3837). Litematica schematic v7 starts here
/// because 1.20.5 rewrote item/block-entity NBT; 1.20.4 and older mods refuse v7.
pub const LITEMATIC_V7_MIN_DATA_VERSION: i32 = 3837;

/// Litematica file `Version`: v6 for 1.18–1.20.4, v7 for 1.20.5+.
pub fn litematic_schematic_version(data_version: i32) -> i32 {
    if data_version >= LITEMATIC_V7_MIN_DATA_VERSION {
        7
    } else {
        6
    }
}

pub fn list_versions() -> Vec<MinecraftVersionInfo> {
    VERSIONS
        .iter()
        .map(|entry| MinecraftVersionInfo {
            id: entry.id.to_string(),
            label: entry.label.to_string(),
            data_version: entry.data_version,
            available: crate::assets::resolve_minecraft_assets_dir(entry.id).is_some(),
        })
        .collect()
}

pub fn normalize_version_id(requested: &str) -> Result<String, String> {
    let trimmed = requested.trim();
    if trimmed.is_empty() {
        return Err("minecraft version id is empty".into());
    }
    if version_def(trimmed).is_some() {
        return Ok(trimmed.to_string());
    }
    Err(format!("unknown Minecraft version '{trimmed}'"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn litematic_v6_before_1_20_5_and_v7_after() {
        assert_eq!(litematic_schematic_version(3463), 6); // 1.20
        assert_eq!(litematic_schematic_version(3700), 6); // 1.20.4
        assert_eq!(litematic_schematic_version(3837), 7); // 1.20.5
        assert_eq!(litematic_schematic_version(3839), 7); // 1.20.6
        assert_eq!(litematic_schematic_version(4903), 7); // 26.2
        for def in registered_versions() {
            let expected = if def.data_version >= LITEMATIC_V7_MIN_DATA_VERSION {
                7
            } else {
                6
            };
            assert_eq!(
                litematic_schematic_version(def.data_version),
                expected,
                "Litematica schematic version for {}",
                def.id
            );
        }
    }
}
