import * as vscode from 'vscode';
import fs = require('fs');
import path = require('path');
import Consts from './Consts';
import OrchestrationStepsRenumber from './OrchestrationStepsRenumber';

export default class PolicBuild {
    static Build() {


        var rootPath: string;
        // Check if a folder is opened
        if ((!vscode.workspace.workspaceFolders) || (vscode.workspace.workspaceFolders.length == 0)) {
            vscode.window.showWarningMessage("To build a policy you need to open the policy folder in VS code");
            return;
        }

        rootPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
        var filePath = path.join(rootPath, "appsettings.json");

        // Check if appsettings.json is existed under for root folder
        vscode.workspace.findFiles(new vscode.RelativePattern(vscode.workspace.rootPath as string, 'appsettings.json'))
            .then((uris) => {

                if (!uris || uris.length == 0) {
                    vscode.window.showQuickPick(["Yes", "No"], { placeHolder: 'The appsettings.json file is missing, do you want to create?' })
                        .then(result => {
                            if (!result || result === "No")
                                return;

                            // Create app settings file with default values
                            fs.writeFile(filePath, Consts.DefaultDeploymentSettings, 'utf8', (err) => {
                                if (err) throw err;

                                vscode.workspace.openTextDocument(filePath).then(doc => {
                                    vscode.window.showTextDocument(doc);
                                });
                            });
                        });
                }
                else {

                    var appSettings = JSON.parse(fs.readFileSync(filePath, 'utf8'));

                    // Read all policy files from the root directory

                    var environmentFolder;

                    if (appSettings.EnvironmentsFolder == null) {
                        environmentFolder = "Environments";
                    } else {
                        environmentFolder = appSettings.EnvironmentsFolder;
                    }
                    var tmpFiles = new Set<string>();
                    vscode.workspace.findFiles(new vscode.RelativePattern(vscode.workspace.rootPath as string, '**/*.{xml}'), `**/${environmentFolder}/**`)
                        .then((uris) => {
                            let policyFiles: PolicyFile[] = [];
                            uris.forEach((uri) => {
                                if (uri.fsPath.indexOf("?") <= 0) {
                                    var data = fs.readFileSync(uri.fsPath, 'utf8');
                                    policyFiles.push(new PolicyFile(uri.fsPath, data.toString()));
                                }
                            });

                            return policyFiles;
                        }).then((policyFiles) => {
                            // Automatically renumber orchestration steps if they are out of order
                            let config = vscode.workspace.getConfiguration('aadb2c');
                            if (config.autoRenumber) {
                                OrchestrationStepsRenumber.RenumberPolicies(policyFiles);
                            }

                            // Get the app settings
                            vscode.workspace.openTextDocument(filePath).then(doc => {
                                var appSettings = JSON.parse(doc.getText());
                                var environmentsRootPath = path.join(rootPath, environmentFolder);

                                // Ensure environments folder exists
                                if (!fs.existsSync(environmentsRootPath)) {
                                    fs.mkdirSync(environmentsRootPath);
                                }

                                // Iterate through environments  
                                appSettings.Environments.forEach(function (entry) {

                                    if (entry.PolicySettings == null) {
                                        vscode.window.showErrorMessage("Can't generate '" + entry.Name + "' environment policies. Error: Accepted PolicySettings element is missing. You may use old version of the appSettings.json file. For more information, see [App Settings](https://github.com/yoelhor/aad-b2c-vs-code-extension/blob/master/README.md#app-settings)");
                                    }
                                    else {
                                        var environmentRootPath = path.join(environmentsRootPath, entry.Name);

                                        // Ensure environment folder exists
                                        if (!fs.existsSync(environmentRootPath)) {
                                            fs.mkdirSync(environmentRootPath);
                                        }

                                        // Iterate through the list of settings
                                        policyFiles.forEach(function (file) {

                                            var policContent = file.Data;

                                            // Replace the tenant name
                                            policContent = policContent.replace(new RegExp("\{Settings:Tenant\}", "gi"), entry.Tenant);

                                            // Replace the file name
                                            policContent = policContent.replace(new RegExp("\{Settings:Filename\}", "gi"), file.FileName.replace(/\.[^/.]+$/, ""));

                                            // Replace the file name and remove the policy prefix
                                            policContent = policContent.replace(new RegExp("\{Settings:PolicyFilename\}", "gi"), file.FileName.replace(/\.[^/.]+$/, "").replace(new RegExp("B2C_1A_", "g"), ""),);

                                            // Replace the environment name
                                            policContent = policContent.replace(new RegExp("\{Settings:Environment\}", "gi"), entry.Name);

                                            // Replace the rest of the policy settings
                                            Object.keys(entry.PolicySettings).forEach(key => {
                                                policContent = policContent.replace(new RegExp("\{Settings:" + key + "\}", "gi"), entry.PolicySettings[key]);
                                            });

                                            // Check to see if the policy's subdirectory exists.
                                            if (file.SubFolder) {
                                                var policyFolderPath = path.join(environmentRootPath, file.SubFolder);

                                                if (!fs.existsSync(policyFolderPath)) {
                                                    fs.mkdirSync(policyFolderPath, { recursive: true });
                                                }
                                            }

                                            var filePath: string;

                                            // Save the  policy
                                            if (file.SubFolder) {
                                                filePath = path.join(policyFolderPath, file.FileName);
                                            } else {
                                                filePath = path.join(environmentRootPath, file.FileName);
                                            }

                                            fs.writeFileSync(filePath, policContent, 'utf8');
                                        });
                                        //iterate through identity providers and produce policies based on the template
                                        if (entry.IdentityProviders != null) {
                                            entry.IdentityProviders.forEach(idp => {
                                                if (idp.Template != null) {
                                                    var templatePath = path.join(environmentRootPath, idp.Template);
                                                    //add idp template file to cleanup list since it is not valid on its own.
                                                    tmpFiles.add(templatePath);

                                                    //grab the already written template so environment settings are propagated.
                                                    var idpContent = fs.readFileSync(templatePath, 'utf8');

                                                    //Replace the Identity Provider name
                                                    idpContent = idpContent.replace(new RegExp("\{IdentityProvider:Name\}", "gi"), idp.Name);

                                                    //Replace the rest of the policy settings                    
                                                    Object.keys(idp.PolicySettings).forEach(key => {
                                                        idpContent = idpContent.replace(new RegExp("\{IdentityProvider:" + key + "\}", "gi"), idp.PolicySettings[key]);
                                                    });

                                                    //Save the policy by appending the idp name to the template file name.
                                                    var idpPolicyFileName = idp.Template.replace(".xml", idp.Name + ".xml");
                                                    idpPolicyFileName = path.join(environmentRootPath, idpPolicyFileName);
                                                    fs.writeFile(idpPolicyFileName, idpContent, 'utf8', (err) => {
                                                        if (err) throw err;
                                                    });
                                                }
                                                //iterate through applications and produce policies mapped to this idp
                                                if (entry.Applications != null) {
                                                    entry.Applications.forEach(app => {
                                                        var appPath = path.join(environmentRootPath, app.Template);

                                                        //add app template file to cleanup list since it is not valid on its own.
                                                        tmpFiles.add(appPath);

                                                        //grab the already written template so environment settings are propagated.
                                                        var appContent = fs.readFileSync(appPath, 'utf8');

                                                        //Replace the Identity Provider name
                                                        appContent = appContent.replace(new RegExp("\{IdentityProvider:Name\}", "gi"), idp.Name);

                                                        //Replace the Application name                                                
                                                        appContent = appContent.replace(new RegExp("\{Application:Name\}", "gi"), app.Name);

                                                        //Replace the rest of the idp settings                    
                                                        Object.keys(idp.PolicySettings).forEach(key => {
                                                            appContent = appContent.replace(new RegExp("\{IdentityProvider:" + key + "\}", "gi"), idp.PolicySettings[key]);
                                                        });

                                                        //Replace the rest of the app settings             
                                                        Object.keys(app.PolicySettings).forEach(key => {
                                                            appContent = appContent.replace(new RegExp("\{Application:" + key + "\}", "gi"), app.PolicySettings[key]);
                                                        });

                                                        //Save the policy by appending the idp name to the template file name.
                                                        var appPolicyFileName = app.Template.replace(".xml", idp.Name + "_" + app.Name + ".xml");
                                                        appPolicyFileName = path.join(environmentRootPath, appPolicyFileName);
                                                        fs.writeFile(appPolicyFileName, appContent, 'utf8', (err) => {
                                                            if (err) throw err;
                                                        });
                                                    });
                                                }
                                            });
                                        }
                                    }
                                });
                                tmpFiles.forEach(function (file) {
                                    fs.unlink(file, (err) => {
                                        if (err) throw err;
                                    });
                                });
                                vscode.window.showInformationMessage("Your policies successfully exported and stored under the Environment folder.");
                            });
                        });
                }
            });
    };

    static GetAllSettings(): string[] {

        var items: string[] = [];

        var rootPath: string;
        // Check if a folder is opened
        if ((!vscode.workspace.workspaceFolders) || (vscode.workspace.workspaceFolders.length == 0)) {
            return items;
        }

        // Get the app settings file path
        rootPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
        var filePath = path.join(rootPath, "appsettings.json");

        // Check if file exists
        if (fs.existsSync(filePath)) {
            var fileContent = fs.readFileSync(filePath, "utf8");
            var appSettings = JSON.parse(fileContent);

            // Add static settings
            items.push('{Settings:Tenant}');
            items.push('{Settings:Filename}');
            items.push('{Settings:PolicyFilename}');
            items.push('{Settings:Environment}');

            // Add the items from each environment
            appSettings.Environments.forEach(function (entry) {

                // Replace the rest of the policy settings
                Object.keys(entry.PolicySettings).forEach(key => {

                    if (items.indexOf('{Settings:' + key + '}') == (-1)) {
                        items.push('{Settings:' + key + '}');
                    }
                });
            });
        }

        return items;
    }
}

export class PolicyFile {
    public FileName: string;
    public Data: string;
    public SubFolder: string;

    constructor(fileName: string, data: string) {
        this.Data = data;
        this.FileName = path.basename(fileName);
        this.SubFolder = this.GetSubFolder(fileName);
    }

    GetSubFolder(filePath: string): string {
        var relativePath = vscode.workspace.asRelativePath(filePath, false);
        var subFolder = relativePath.substring(0, relativePath.lastIndexOf('/'));

        if (!subFolder) {
            return null;
        }
        return subFolder;
    }

}
