export type MinifyOptions = { 
    excludes: string[]; 
    minify: { 
        remove_whitespace: boolean; 
        remove_comments: boolean; 
        minify_html: boolean; 
    }; 
    output: string; 
}

export const DefaultMinifyOptions: MinifyOptions = {
    "excludes": [
        '$GLOBALS', '$_SERVER', '$_GET', '$_POST', '$_FILES', '$_REQUEST', '$_SESSION', '$_ENV', '$_COOKIE',
        '$php_errormsg', '$HTTP_RAW_POST_DATA', '$http_response_header', '$argc', '$argv', '$this'
    ],
    "minify": {
        "remove_whitespace": true,
        "remove_comments": true,
        "minify_html": false
    },
    "output": ""
}