/* global $, calibre, EPUBJS, ePubReader */

var reader;

(function() {
    "use strict";

    EPUBJS.filePath = calibre.filePath;
    EPUBJS.cssPath = calibre.cssPath;

    reader = ePubReader(calibre.bookUrl, {
        restore: true,
        bookmarks: calibre.bookmark ? [calibre.bookmark] : [],
        annotations: calibre.annotations ? calibre.annotations : [],
    });

    Object.keys(themes).forEach(function (theme) {
        reader.rendition.themes.register(theme, themes[theme].css_path);
    });

    if (calibre.useBookmarks) {
        reader.on("reader:bookmarked", updateBookmark.bind(reader, "add"));
        reader.on("reader:unbookmarked", updateBookmark.bind(reader, "remove"));
    } else {
        $("#bookmark, #show-Bookmarks").remove();
    }

    // Enable swipe support
    // I have no idea why swiperRight/swiperLeft from plugins is not working, events just don't get fired
    var touchStart = 0;
    var touchEnd = 0;

    reader.rendition.on('touchstart', function(event) {
        touchStart = event.changedTouches[0].screenX;
    });
    reader.rendition.on('touchend', function(event) {
      touchEnd = event.changedTouches[0].screenX;
        if (touchStart < touchEnd) {
            if(reader.book.package.metadata.direction === "rtl") {
    			reader.rendition.next();
    		} else {
    			reader.rendition.prev();
    		}
            // Swiped Right
        }
        if (touchStart > touchEnd) {
            if(reader.book.package.metadata.direction === "rtl") {
    			reader.rendition.prev();
    		} else {
                reader.rendition.next();
    		}
            // Swiped Left
        }
    });

    // Update progress percentage
    let progressDiv = document.getElementById("progress");
    reader.book.ready.then((()=>{
        let locations_key = reader.book.key()+'-locations';
        let stored_locations = localStorage.getItem(locations_key);
        let make_locations, save_locations;
        if (stored_locations) {
            make_locations = Promise.resolve(reader.book.locations.load(stored_locations));
            // No-op because locations are already saved
            save_locations = ()=>{};
        } else {
            make_locations = reader.book.locations.generate();
            save_locations = ()=>{
                localStorage.setItem(locations_key, reader.book.locations.save());
            };
        }
        make_locations.then(()=>{
            // FIXME: Annotations are appearing to be off by an inconsistent amount on reload
            // .It's likely that other bits of data are necessary to properly represent the range
            // .Although it could also be a visual error in the epub reader itself given that it seems to be off by a vertical line of text exactly
            reader.settings.annotations.forEach((a) => {
                const id = a.id;
                const cfiRange = a.data;

                reader.rendition.annotations.highlight(cfiRange, {id: id}, (e) => {
                    reader.rendition.annotations.remove(cfiRange, "highlight");
                    updateAnnotation(id, "remove", "highlight", cfiRange);
                });
            });

            reader.rendition.on("selected", function(cfiRange, contents) {
                const id = EPUBJS.core.uuid();
                reader.rendition.annotations.highlight(cfiRange, {id: id}, (e) => {
                    reader.rendition.annotations.remove(cfiRange, "highlight");
                    updateAnnotation(id, "remove", "highlight", cfiRange);
                });

                updateAnnotation(id, "add", "highlight", cfiRange);
                contents.window.getSelection().removeAllRanges();
            });

            reader.rendition.on('relocated', (location)=>{
                const spineItem = reader.book.spine.get(location.start.index);
                const baseCfi = spineItem.cfiBase;
                const allLocations = reader.book.locations._locations;

                const bookNormalized = reader.book.locations.percentageFromCfi(location.start.cfi);
                const percentageBook = Math.round(bookNormalized*100);

                let percentageSection = 0;
                const sectionStartCfi = allLocations.find(cfi => cfi.includes(baseCfi));
                const sectionEndCfi = allLocations.findLast(cfi => cfi.includes(baseCfi));

                if (sectionStartCfi == sectionEndCfi) {
                    percentageSection = 100;
                } else {
                    const sectionStartNormalized = reader.book.locations.percentageFromCfi(sectionStartCfi);
                    const sectionEndNormalized = reader.book.locations.percentageFromCfi(sectionEndCfi);
                    const sectionBookProportion = sectionEndNormalized - sectionStartNormalized;
                    const sectionNormalized = (bookNormalized-sectionStartNormalized)/sectionBookProportion;
                    percentageSection = Math.round(sectionNormalized*100);
                }

                progressDiv.textContent=`${percentageSection}% (${percentageBook}% in book)`;

                // Auto-bookmark new location if it's past the current bookmark
                let cfi = location.start.cfi;
                if(cfi) {
                    const currentCfi = new ePub.CFI(cfi);
                    const bookmarkedCfi = reader.settings.bookmarks.find((bookmark) => {
                        return currentCfi.compare(cfi, bookmark) == 1;
                    });
                    if(bookmarkedCfi) {
                        // Clear reader and DOM bookmarks
                        reader.clearBookmarks();
                        $("#bookmarks").empty();
                        // Add the current location as bookmark
                        reader.addBookmark(cfi);
                        // Fixup the bookmark icon state
                        const bookmarkIcon = $("#title-controls #bookmark");
                        bookmarkIcon.removeClass("icon-bookmark-empty");
                        bookmarkIcon.addClass("icon-bookmark");
                    }
                }
            });
            reader.rendition.reportLocation();
            progressDiv.style.visibility = "visible";
        }).then(save_locations);
    }));

    /**
     * @param {string} action - Add or remove bookmark
     * @param {string|int} location - Location or zero
     */
    function updateBookmark(action, location) {
        // Remove other bookmarks (there can only be one)
        if (action === "add") {
            this.settings.bookmarks.filter(function (bookmark) {
                return bookmark && bookmark !== location;
            }).map(function (bookmark) {
                this.removeBookmark(bookmark);
            }.bind(this));
        }
        
        var csrftoken = $("input[name='csrf_token']").val();

        // Save to database
        $.ajax(calibre.bookmarkUrl, {
            method: "post",
            data: { bookmark: location || "" },
            headers: { "X-CSRFToken": csrftoken }
        }).fail(function (xhr, status, error) {
            alert(error);
        });
    }
    
    function updateAnnotation(id, action, annotationType, cfiRange, note) {
        var csrftoken = $("input[name='csrf_token']").val();

        // Save to database
        $.ajax(calibre.annotationUrl, {
            method: "post",
            data: {
                id: id,
                action: action,
                type: annotationType,
                range: cfiRange,
            },
            headers: { "X-CSRFToken": csrftoken }
        }).fail(function (xhr, status, error) {
            alert(error);
        });
    }

    // Default settings load
    const theme = localStorage.getItem("calibre.reader.theme") ?? "lightTheme";
    selectTheme(theme);
})();
