const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Function to install pg package
function installPg() {
  try {
    console.log('Installing pg package...');
    
    // Create a temporary directory
    const tempDir = path.join(__dirname, 'temp_install');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir);
    }
    
    // Create a minimal package.json in the temp directory
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({
        name: "temp-install",
        version: "1.0.0",
        dependencies: {}
      })
    );
    
    // Change to the temp directory and install pg
    process.chdir(tempDir);
    execSync('npm install pg@8.11.3', { stdio: 'inherit' });
    
    // Copy the pg module to the main node_modules
    const pgModulePath = path.join(tempDir, 'node_modules', 'pg');
    const targetPath = path.join(__dirname, 'node_modules', 'pg');
    
    // Create target directory if it doesn't exist
    if (!fs.existsSync(path.join(__dirname, 'node_modules'))) {
      fs.mkdirSync(path.join(__dirname, 'node_modules'));
    }
    
    // Copy pg module recursively
    copyFolderRecursiveSync(pgModulePath, path.join(__dirname, 'node_modules'));
    
    // Clean up
    process.chdir(__dirname);
    fs.rmSync(tempDir, { recursive: true, force: true });
    
    console.log('pg package installed successfully!');
  } catch (error) {
    console.error('Error installing pg package:', error);
  }
}

// Function to copy folder recursively
function copyFolderRecursiveSync(source, target) {
  // Check if folder needs to be created or integrated
  const targetFolder = path.join(target, path.basename(source));
  if (!fs.existsSync(targetFolder)) {
    fs.mkdirSync(targetFolder, { recursive: true });
  }

  // Copy
  if (fs.lstatSync(source).isDirectory()) {
    const files = fs.readdirSync(source);
    files.forEach(function(file) {
      const curSource = path.join(source, file);
      if (fs.lstatSync(curSource).isDirectory()) {
        copyFolderRecursiveSync(curSource, targetFolder);
      } else {
        fs.copyFileSync(curSource, path.join(targetFolder, file));
      }
    });
  }
}

// Run the installation
installPg(); 