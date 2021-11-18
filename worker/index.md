
﻿<!DOCTYPE html>
<html>
<head>
    <title>ArcToCore BPMN</title>
    <link rel="stylesheet" href="vendor/bpmn-js/assets/diagram-js.css" />
    <link rel="stylesheet" href="vendor/bpmn-js/assets/bpmn-font/css/bpmn-embedded.css" />
    <link rel="stylesheet" href="vendor/bpmn-js/assets/bpmn-font/css/bpmn.css" />
    <link rel="stylesheet" href="vendor/diagram-js-minimap/assets/diagram-js-minimap.css" />
    <link rel="stylesheet" href="vendor/w3-css/3/w3.css" />
    <link rel="stylesheet" href="vendor/font-awesome/css/font-awesome.css" />
    <link rel="stylesheet" href="css/app.css" />
    <link rel="shortcut icon" href="arc80x80.png" type="image/x-icon">
<!-- Global site tag (gtag.js) - Google Analytics -->
<script async src="https://www.googletagmanager.com/gtag/js?id=UA-135964162-1"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', 'UA-135964162-1');
</script>

</head>
<body>

    <div id="id01" class="w3-modal">
        <div class="w3-modal-content w3-card-4">
            <header class="w3-container" style="background-color: #8bc34a">
                <span onclick="document.getElementById('id01').style.display='none'"
                      class="w3-button w3-display-topright" style="background-color: #8bc34a">&times;</span>
                <h2>Keyboard Shortcuts</h2>
            </header>
            <div class="w3-container">
                <div id="content"></div>
            </div>
        </div>
    </div>

    <div class="navbar">
        <div class="topnav-right">
            <label class="custom-file-x">
                <input type="file" data-open-file value="open" />
                <i class="fa fa-2x fa-folder-open"></i>
            </label>

            <label class="custom-file-x">
                <i onclick="document.getElementById('id01').style.display='block'" class="fa fa-2x fa-keyboard-o" style="color:green;"></i>
            </label>

          
        </div>

        <div class="dropdown">
            <button class="dropbtn">
                Diagram
                <i class="fa fa-caret-down"></i>
            </button>
            <div class="dropdown-content">
                <a href><i class="fa fa-file" onclick="createNewDiagram();"></i> New diagram</a>
                <a href id="js-download-diagram"><i class="fa fa-cloud-download"></i> Download diagram</a>
                <a href id="js-download-svg"><i class="fa fa-file-image-o"></i> Download SVG Image</a>
            </div>
        </div>
    </div>

    <div class="content" id="js-drop-zone">
        <div class="message error">
            <div class="note">
                <p>We could not display the BPMN 2.0 diagram.</p>
                <div class="details">
                    <span>cause of the problem</span>
                    <pre></pre>
                </div>
            </div>
        </div>
        <div class="canvas" id="js-canvas">
        </div>
    </div>

    <script src="app.js"></script>
</body>
</html>
