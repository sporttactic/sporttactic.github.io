$("iframe").each(function() { 
        var src= $(this).attr('src');
        $(this).attr('src',src);  
});

 function DeleteIndexDB()
 {
	 try
	 {
		 window.indexedDB.databases().then((r) => {
		for (var i = 0; i < r.length; i++) window.indexedDB.deleteDatabase(r[i].name);
		}).then(() => {
			//alert('All data cleared.');
		});
	 }
	 catch(err) {}
	 
	 
 }
 
function convertDurationtoSeconds(duration)
{
	const [hours, minutes, seconds] = duration.split(':');
    return Number(hours) * 60 * 60 + Number(minutes) * 60 + Number(seconds);
};

function TimeInterval(totalSeconds) {
  var hours   = Math.floor(totalSeconds / 3600);
  var minutes = Math.floor((totalSeconds - (hours * 3600)) / 60);
  var seconds = totalSeconds - (hours * 3600) - (minutes * 60);

  // round seconds
  seconds = Math.round(seconds * 100) / 100

  var result = (hours < 10 ? "0" + hours : hours);
      result += ":" + (minutes < 10 ? "0" + minutes : minutes);
      result += ":" + (seconds  < 10 ? "0" + seconds : seconds);
  return result;
}
 
 
 

function ClearAllCookies() {
	document.cookie = "no=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
	document.cookie = "yes=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
	document.cookie = "why=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
}

function DeleteItems() {
  localStorage.clear();
}

function DeleteItem(track)
{
localStorage.removeItem(track);	
}


function SetStorageDA(name, valX)
{
	try{
	localStorage.setItem(name, valX);
	}
	catch(err){
		return "Det er ikke muligt at gemme så mange spil sekvenser i browserens hukommelse";
	}
	return "Spil sekvenser gemt lokalt til offline brug"
}

function SetStorageEN(name, valX)
{
	try{
	localStorage.setItem(name, valX);
	}
	catch(err){
		return "It is not possible to store so many play sequences in the browser's memory";
	}
	return "Play sequences stored for offline use"
}


function GetStorage(name, valX)
{
	try{
	return localStorage.getItem(name, valX);
	}
	catch(err){
		return "";
	}
	return ""
	
	
}

function GetStorageItem(name)
{
	return localStorage.getItem(name);
}

function DeleteDB()
{
	window.indexeddb.deletedatabase('_c2savestates');
}

document.addEventListener('copy', function (evt) {
  evt.clipboardData.setData('text/plain','');
});

function StripHtml(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.body.textContent || "";
}





$(function() {
	$('#search-form').submit(function(e) {
		e.preventDefault();
	})
});

function search() {
	//Clear any previous results 
	$('#results').html('');
	$('#btn-cnt').html('');	
	
	//Get form input
	var q = $('#query').val();
	
	//Run GET Request 	on API
	$.get(
		"https://www.googleapis.com/youtube/v3/search",{
			part: 'snippet, id',
			q: q,
			type: 'video',
			key: 'AIzaSyAShx8QLS_bc-cvTWKPfKdNLq6P79mDifc'}, 
			function(data) {
				var nextPageToken = data.nextPageToken;
				var prevPageToken = data.prevPageToken;
				var pageInfo = data.pageInfo;
				
				//Log data
				console.log(data);	
				
				$.each(data.items, function(i, item) {
						//Get output
						var output = getOutput(item);
						
						//Display results
						$('#results').append(output);	
				});
				
				var buttons = getButtons(prevPageToken,nextPageToken, pageInfo);
				
				//Display buttons
				$('#results').prepend(buttons);
				$('#btn-cnt').append(buttons);
			}
	);	
}

//Build Output
	function getOutput(item) {
		var videoId = item.id.videoId;
		var title = item.snippet.title;
		var description = item.snippet.description;
		var thumb = item.snippet.thumbnails.high.url;
		var channelTitle = item.snippet.channelTitle;
		var videoDate = item.snippet.publishedAt;
		
		//Build Output String
		var output = '<div class="row">' + 
		'<div class="col-sm-2">' +	
			'<a data-fancybox href="https://www.youtube.com/watch?v=' + videoId + '"><img class="img-fluid" src="' + thumb + '"></a>' +
		'</div>' +
		'<div class="col-sm-10">' + 
			'<h4><a data-fancybox href="https://www.youtube.com/watch?v=' + videoId + '">' + title + '</a></h4>' +
			'<small>By <span class="cTitle">' + channelTitle + '</span> on '+ videoDate + '</small>' +
			'<p>' + description + '</p>' +
		'</div>' +
		'</div>';
		return output;
			
	}

//Build the Buttons
	function getButtons(prevPageToken,nextPageToken,pageInfo) {
		
		$('#btn-cnt').html('');	
		var btnoutput;
		var q = $('#query').val();
		if(!prevPageToken) {
			btnoutput = '<div class="button-container">' + 
			'<span class="total-results"><label>Total Results :</label>' + pageInfo.totalResults + '</span>' +
			'<button id="next-button" class="btn animated-button thar-three" data-token="' + 	nextPageToken + '" data-query="' + q +'"' +
			'onclick="nextPage();">Next Page</button><div class="clearfix"></div></div>';
			console.log(nextPageToken);
		} else {
			console.log(nextPageToken);
			btnoutput = '<div class="button-container">' +
			'<span class="total-results"><label>Total Results :</label>' + pageInfo.totalResults + '</span>' +
			'<button id="next-button" class="btn  animated-button thar-three" data-token="' + 	nextPageToken + '" data-query="' + q +'"' +
			'onclick="nextPage();">Next Page</button>' +
			'<button id="prev-button" class="btn  animated-button thar-four" data-token="' + 	prevPageToken + '" data-query="' + q +'"' +
			'onclick="prevPage();">Previous Page</button>' +
			'<div class="clearfix"></div></div>';
		}
		return btnoutput;
	}

function nextPage() {
		
		var token = $('#next-button').data('token');
		var q = $('#next-button').data('query');
		//Clear any previous results 
	$('#results').html('');
	$('#btn-cnt').html('');	
	
	//Get form input
	q = $('#query').val();
	
	//Run GET Request 	on API
	$.get(
		"https://www.googleapis.com/youtube/v3/search",{
			part: 'snippet, id',
			q: q,
			pageToken: token,
			type: 'video',
			key: 'AIzaSyCP-z9Cc33ZJ44GMyBjdAQH23TV1U5woPc'}, 
			function(data) {
				var nextPageToken = data.nextPageToken;
				var prevPageToken = data.prevPageToken;
				var pageInfo = data.pageInfo;
				//Log data
				console.log(data);	
				
				$.each(data.items, function(i, item) {
						//Get output
						var output = getOutput(item);
						
						//Display results
						$('#results').append(output);	
				});
				
				var buttons = getButtons(prevPageToken,nextPageToken,pageInfo);
				
				//Display buttons
				$('#results').prepend(buttons);
				$('#btn-cnt').append(buttons);
			}
		);
			
}

function prevPage() {
		
		var token = $('#prev-button').data('token');
		var q = $('#prev-button').data('query');
		//Clear any previous results 
	$('#results').html('');
	$('#btn-cnt').html('');	
	
	//Get form input
	q = $('#query').val();
	
	//Run GET Request 	on API
	$.get(
		"https://www.googleapis.com/youtube/v3/search",{
			part: 'snippet, id',
			q: q,
			pageToken: token,
			type: 'video',
			key: 'AIzaSyAShx8QLS_bc-cvTWKPfKdNLq6P79mDifc'}, 
			function(data) {
				var nextPageToken = data.nextPageToken;
				var prevPageToken = data.prevPageToken;
				var pageInfo = data.pageInfo;
				//Log data
				console.log(data);	
				
				$.each(data.items, function(i, item) {
						//Get output
						var output = getOutput(item);
						
						//Display results
						$('#results').append(output);	
				});
				
				var buttons = getButtons(prevPageToken,nextPageToken,pageInfo);
				
				//Display buttons
				$('#results').prepend(buttons);
				$('#btn-cnt').append(buttons);
			}
		);
			
}

    function getVideo(searchString) {
      $.ajax({
        type: 'GET',
        url: 'https://www.googleapis.com/youtube/v3/search',
        data: {
            key: 'AIzaSyCP-z9Cc33ZJ44GMyBjdAQH23TV1U5woPc',
            q: searchString,
            part: 'snippet',
            maxResults: 1,
            type: 'video',
            videoEmbeddable: true,
        },
        success: function(data){
            embedVideo(data)
        },
        error: function(response){
            console.log("Request Failed");
        }
      });
    }

function embedVideo(data) {
    $('iframe').attr('src', 'https://www.youtube.com/embed/' + data.items[0].id.videoId)
    $('h3').text(data.items[0].snippet.title)
    $('.description').text(data.items[0].snippet.description)
}

getVideo();


function saveFile(blob, filename) {
  if (window.navigator.msSaveOrOpenBlob) {
    window.navigator.msSaveOrOpenBlob(blob, filename);
  } else {
    const a = document.createElement('a');
    document.body.appendChild(a);
    const url = window.URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => {
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    }, 0)
  }
}
