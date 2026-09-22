import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const repoRoot = path.dirname(fileURLToPath(import.meta.url))
const fbxLoaderPath = path.resolve(
  repoRoot,
  'node_modules/three/examples/jsm/loaders/FBXLoader.js',
)

function applyFbxLoaderPatches(code: string): string {
  let next = code

  next = next.replace(
    /if \( 'Scaling' in textureNode \) \{\s*const values = textureNode\.Scaling\.value;\s*texture\.repeat\.x = values\[ 0 \];\s*texture\.repeat\.y = values\[ 1 \];\s*\}/,
    `if ( 'Scaling' in textureNode ) {
			const values = textureNode.Scaling && textureNode.Scaling.value;
			if ( values ) {
				texture.repeat.x = values[ 0 ];
				texture.repeat.y = values[ 1 ];
			}
		}`,
  )

  next = next.replace(
    /if \( 'Translation' in textureNode \) \{\s*const values = textureNode\.Translation\.value;\s*texture\.offset\.x = values\[ 0 \];\s*texture\.offset\.y = values\[ 1 \];\s*\}/,
    `if ( 'Translation' in textureNode ) {
			const values = textureNode.Translation && textureNode.Translation.value;
			if ( values ) {
				texture.offset.x = values[ 0 ];
				texture.offset.y = values[ 1 ];
			}
		}`,
  )

  next = next.replace(
    /const extension = textureNode\.FileName\.split\( '\.' \)\.pop\(\)\.toLowerCase\(\);/,
    `const extension = ( textureNode.FileName || textureNode.RelativeFilename || 'missing.png' ).split( '.' ).pop().toLowerCase();
		if ( ! textureNode.FileName ) textureNode.FileName = textureNode.RelativeFilename || 'missing.png';`,
  )

  next = next.replace(
    /id = connections\.get\( id \)\.children\[ 0 \]\.ID;/,
    `const layeredChildren = connections.get( id ) && connections.get( id ).children;
			if ( ! layeredChildren || layeredChildren.length === 0 ) return undefined;
			id = layeredChildren[ 0 ].ID;`,
  )

  next = next.replace(
    /case 'AllSame' :\s*index = infoObject\.indices\[ 0 \];\s*break;/,
    `case 'AllSame' :
			index = ( infoObject.indices && infoObject.indices.length ) ? infoObject.indices[ 0 ] : 0;
			break;`,
  )

  next = next.replace(
    /if \( infoObject\.referenceType === 'IndexToDirect' \) index = infoObject\.indices\[ index \];/,
    `if ( infoObject.referenceType === 'IndexToDirect' ) index = ( infoObject.indices && infoObject.indices[ index ] !== undefined ) ? infoObject.indices[ index ] : index;`,
  )

  next = next.replace(
    /fbxTree = new BinaryParser\(\)\.parse\( FBXBuffer \);/,
    `fbxTree = new BinaryParser().parse( FBXBuffer );
			(function sanitizeStructureLabFbxTree( tree ) {
				if ( ! tree || ! tree.Objects ) return;
				const textures = tree.Objects.Texture;
				if ( textures ) {
					for ( const key in textures ) {
						const node = textures[ key ];
						if ( ! node ) continue;
						if ( node.Scaling && ! Array.isArray( node.Scaling.value ) ) node.Scaling.value = [ 1, 1, 1 ];
						if ( node.Translation && ! Array.isArray( node.Translation.value ) ) node.Translation.value = [ 0, 0 ];
						if ( ! node.FileName ) node.FileName = node.RelativeFilename || 'missing.png';
					}
				}
			})( fbxTree );`,
  )

  return next
}

/**
 * Three.js FBXLoader crashes on incomplete texture nodes
 * (`Scaling.value[0]`, empty LayeredTexture children, missing FileName).
 * Serve a patched copy so missing textures still yield a mesh.
 */
function patchFbxLoader(): Plugin {
  const patchedQuery = '?structurelab-fbx-patch'
  return {
    name: 'structurelab-patch-fbx-loader',
    enforce: 'pre',
    resolveId(source) {
      if (
        source === 'three/addons/loaders/FBXLoader.js'
        || source === 'three/examples/jsm/loaders/FBXLoader.js'
      ) {
        // Keep the real path so relative imports (fflate, NURBSCurve) still resolve.
        return fbxLoaderPath + patchedQuery
      }
      return null
    },
    load(id) {
      if (!id.replaceAll('\\', '/').includes('/loaders/FBXLoader.js') || !id.includes('structurelab-fbx-patch')) {
        return null
      }
      const code = fs.readFileSync(fbxLoaderPath, 'utf8')
      const patched = applyFbxLoaderPatches(code)
      if (patched === code) {
        this.warn('structurelab-patch-fbx-loader: no FBXLoader patches applied — three.js source may have changed')
      }
      return patched
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [patchFbxLoader(), react()],
  optimizeDeps: {
    exclude: ['three/addons/loaders/FBXLoader.js', 'three/examples/jsm/loaders/FBXLoader.js'],
  },
  build: {
    // heic2any is a single ~1.3MB async module (maps HEIC import only).
    // Warn above that so we still catch accidental mega-bundles.
    chunkSizeWarningLimit: 1400,
    rolldownOptions: {
      output: {
        codeSplitting: {
          // Do NOT use a catch-all node_modules → vendor group: it forces async
          // deps (heic2any, utif, …) into one huge shared chunk.
          groups: [
            {
              name: 'three',
              test: /node_modules[\\/]three(?:[\\/]|$)/,
              priority: 40,
            },
            {
              name: 'react-vendor',
              test: /node_modules[\\/](?:react|react-dom|scheduler)(?:[\\/]|$)/,
              priority: 30,
            },
            {
              name: 'ogl',
              test: /node_modules[\\/]ogl(?:[\\/]|$)/,
              priority: 20,
            },
            {
              name: 'tauri',
              test: /node_modules[\\/]@tauri-apps[\\/]/,
              priority: 20,
            },
            {
              name: 'heic',
              test: /node_modules[\\/]heic2any(?:[\\/]|$)/,
              priority: 20,
            },
            {
              name: 'utif',
              test: /node_modules[\\/]utif(?:[\\/]|$)/,
              priority: 20,
            },
          ],
        },
      },
    },
  },
})
