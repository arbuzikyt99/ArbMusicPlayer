/* Добавляет signing config для release-сборки APK */
'use strict';
const fs = require('fs');
const G = 'C:/Users/User/OneDrive/Desktop/ArbMusic/android/app/build.gradle';
let g = fs.readFileSync(G, 'utf8');
if (g.includes('signingConfigs')) { console.log('уже есть'); process.exit(0); }
const anchor = 'android {';
if (!g.includes(anchor)) throw new Error('android block not found');
g = g.replace(anchor, `def keystoreProperties = new Properties()
def keystorePropertiesFile = rootProject.file("keystore.properties")
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

` + anchor);
g = g.replace(/    buildTypes \{\n        release \{\n            minifyEnabled false/, `    signingConfigs {
        release {
            keyAlias keystoreProperties['keyAlias']
            keyPassword keystoreProperties['keyPassword']
            storeFile file(keystoreProperties['storeFile'])
            storePassword keystoreProperties['storePassword']
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled false`);
fs.writeFileSync(G, g);
console.log('signing config added');
