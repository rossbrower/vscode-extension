<#
.SYNOPSIS
   Build the Trusted Framework policies for each defined environment
.DESCRIPTION
   The script replaces the keys with the value configure in the appsettings.json file contains the keys with their values for each environment:
    •Name - contains the environment name which VS code extension uses to create the environment folder (under the environments parent folder). Use your operation system legal characters only.
    •Tenant - specifies the tenant name, such as contoso.onmicrosoft.com. In the policy file, use the format of Settings:Tenant, for example {Settings:Tenant}.
    •Production - (boolean) is preserved for future use, indicating whether the environment is a production one.
    •PolicySettings - contains a collection of key-value pair with your settings. In the policy file, use the format of Settings: and the key name, for example {Settings:FacebookAppId}.
.NOTES    
    ChangeLog:
        1.0.0 - Converted VSCODE script to Powrshell for Build Server usage - https://github.com/azure-ad-b2c/vscode-extension/blob/master/src/PolicyBuild.ts
.PREREQUISITES
   The following resources must be pre created before running the script
   1. appsettings.json file exists in proper format        
#>
param(
    #File Path containing the appsettings.json and the XML policy files
    [Parameter(Mandatory = $true)]
    [string]
    $FilePath
)

try {
    #Check if appsettings.json is existed under for root folder        
    $AppSettingsFile = Join-Path $FilePath "appsettings.json"

    #Create app settings file with default values
    $AppSettingsJson = Get-Content -Raw -Path $AppSettingsFile | ConvertFrom-Json

    #Read all policy files from the root directory            
    $XmlPolicyFiles = Get-ChildItem -Path $FilePath -Filter *.xml
    Write-Verbose "Files found: $XmlPolicyFiles"

    #Get the app settings                        
    $EnvironmentsRootPath = Join-Path $FilePath "Environments"

    #Ensure environments folder exists
    if ((Test-Path -Path $EnvironmentsRootPath -PathType Container) -ne $true) {
        New-Item -ItemType Directory -Force -Path $EnvironmentsRootPath | Out-Null
    }                                    

    #temp files that will be deleted at the end.
    $tmpFiles = @{};

    #Iterate through environments  
    foreach ($entry in $AppSettingsJson.Environments) {
        Write-Verbose "ENVIRONMENT: $($entry.Name)"

        if ($null -eq $entry.PolicySettings) {
            Write-Error "Can't generate '$($entry.Name)' environment policies. Error: Accepted PolicySettings element is missing. You may use old version of the appSettings.json file. For more information, see [App Settings](https://github.com/yoelhor/aad-b2c-vs-code-extension/blob/master/README.md#app-settings)"
        }
        else {
            $environmentRootPath = Join-Path $EnvironmentsRootPath $entry.Name

            if ((Test-Path -Path $environmentRootPath -PathType Container) -ne $true) {
                New-Item -ItemType Directory -Force -Path $environmentRootPath | Out-Null
            }    

            #Iterate through the list of files and replace environment settings
            foreach ($file in $XmlPolicyFiles) {
                Write-Verbose "FILE: $($entry.Name) - $file"

                $policContent = Get-Content (Join-Path $FilePath $file.Name) | Out-String

                #Replace the tenant name
                $policContent = $policContent -replace "\{Settings:Tenant\}", $entry.Tenant

                #Replace the rest of the policy settings
                $policySettingsHash = @{}; #ugly hash conversion from psobject so we can access json properties via key
                $entry.PolicySettings.psobject.properties | ForEach-Object { $policySettingsHash[$_.Name] = $_.Value }
                foreach ($key in $policySettingsHash.Keys) {
                    Write-Verbose "KEY: $key VALUE: $($policySettingsHash[$key])"
                    $policContent = $policContent -replace "\{Settings:$($key)\}", $policySettingsHash[$key]
                }

                #Save the  policy
                $policContent | Set-Content ( Join-Path $environmentRootPath $file.Name)

            }

            #iterate through identity providers and produce policies based on the template
            foreach ($idp in $entry.IdentityProviders) {                
                $templatePath = Join-Path $environmentRootPath $idp.Template;                
                #add idp template file to cleanup list since it is not valid on its own.
                $tmpFiles[$templatePath] = $null;
                #grab the already written template so environment settings are propagated.
                $idpContent = Get-Content $templatePath | Out-String;
                #Replace the Identity Provider name
                $idpContent = $idpContent -replace "\{IdentityProvider:Name\}", $idp.Name
                #Replace the rest of the policy settings
                $idpSettingsHash = @{}; #ugly hash conversion from psobject so we can access json properties via key
                $idp.PolicySettings.psobject.properties | ForEach-Object { $idpSettingsHash[$_.Name] = $_.Value }
                foreach ($key in $idpSettingsHash.Keys) {
                    Write-Verbose "KEY: $key VALUE: $($idpSettingsHash[$key])"
                    $idpContent = $idpContent -replace "\{IdentityProvider:$($key)\}", $idpSettingsHash[$key]
                }                
                #Save the policy by appending the idp name to the template file name.
                $idpPolicyFileName = $idp.Template.Replace(".xml", $idp.Name + ".xml");
                $idpContent | Set-Content (Join-Path $environmentRootPath $idpPolicyFileName)  

                #iterate through applications and produce policies mapped to this idp
                foreach ($app in $entry.Applications) {
                    $appPath = Join-Path $environmentRootPath $app.Template; 
                    #add app template file to cleanup list since it is not valid on its own.
                    $tmpFiles[$appPath] = $null;
                    #grab the already written template so environment settings are propagated.
                    $appContent = Get-Content $appPath | Out-String;                    
                    #Replace the Identity Provider name
                    $appContent = $appContent -replace "\{IdentityProvider:Name\}", $idp.Name
                    #Replace the Application name
                    $appContent = $appContent -replace "\{Application:Name\}", $app.Name

                    #Replace the rest of the app settings
                    $appSettingsHash = @{}; #ugly hash conversion from psobject so we can access json properties via key
                    $app.PolicySettings.psobject.properties | ForEach-Object { $appSettingsHash[$_.Name] = $_.Value }
                    foreach ($key in $appSettingsHash.Keys) {
                        Write-Verbose "KEY: $key VALUE: $($appSettingsHash[$key])"
                        $appContent = $appContent -replace "\{Application:$($key)\}", $appSettingsHash[$key]
                    }                
                    #Save the policy by appending the idp name to the template file name.
                    $appPolicyFileName = $app.Template.Replace(".xml", $idp.Name + "_" + $app.Name + ".xml");
                    $appContent | Set-Content ( Join-Path $environmentRootPath $appPolicyFileName )
                }
            }
            foreach($key in $tmpFiles.keys)
            {
                Remove-Item $key;
            }
        }

        Write-Output "You policies successfully exported and stored under the Environment folder ($($entry.Name))."
    }
}
catch {
    Write-Error $_
}
