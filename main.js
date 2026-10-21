/* ==========================================
   ORION REALM
   COSMIC INTERACTION ENGINE
   ========================================== */

document.addEventListener("DOMContentLoaded", () => {

    const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
    ).matches;


    /* 1. COPYRIGHT YEAR */

    const yearElement = document.getElementById("year");

    if (yearElement) {
        yearElement.textContent = new Date().getFullYear();
    }


    /* 2. SCROLL PROGRESS BAR */

    const progressBar = document.createElement("div");

    progressBar.className = "scroll-progress";
    progressBar.setAttribute("aria-hidden", "true");

    document.body.appendChild(progressBar);


    let ticking = false;

    function updateScrollProgress() {

        const documentHeight =
            document.documentElement.scrollHeight;

        const scrollableHeight =
            documentHeight - window.innerHeight;

        const scrollPosition = window.scrollY;

        const progress = scrollableHeight > 0
            ? (scrollPosition / scrollableHeight) * 100
            : 0;

        progressBar.style.width = `${progress}%`;

        ticking = false;
    }


    window.addEventListener("scroll", () => {

        if (!ticking) {

            window.requestAnimationFrame(updateScrollProgress);

            ticking = true;
        }

    }, { passive: true });


    window.addEventListener("resize", updateScrollProgress);

    updateScrollProgress();


    /* 3. SCROLL REVEAL */

    const revealElements = document.querySelectorAll(
        ".content-section, .final-section"
    );


    revealElements.forEach((element) => {

        element.classList.add("reveal");

    });


    if (
        reducedMotion ||
        !("IntersectionObserver" in window)
    ) {

        revealElements.forEach((element) => {

            element.classList.add("visible");

        });

    } else {

        const observer = new IntersectionObserver(
            (entries, currentObserver) => {

                entries.forEach((entry) => {

                    if (entry.isIntersecting) {

                        entry.target.classList.add("visible");

                        currentObserver.unobserve(entry.target);
                    }

                });

            },
            {
                threshold: 0.12,
                rootMargin: "0px 0px -35px 0px"
            }
        );


        revealElements.forEach((element) => {

            observer.observe(element);

        });

    }


    /* 4. SMOOTH SECTION NAVIGATION */

    document.querySelectorAll('a[href^="#"]').forEach((link) => {

        link.addEventListener("click", (event) => {

            const targetId = link.getAttribute("href");

            if (!targetId || targetId === "#") {
                return;
            }

            const target = document.querySelector(targetId);

            if (!target) {
                return;
            }

            event.preventDefault();

            target.scrollIntoView({

                behavior: reducedMotion ? "auto" : "smooth",

                block: "start"

            });

            if (history.replaceState) {

                history.replaceState(null, "", targetId);

            }

        });

    });


    /* 5. COSMIC INITIALIZATION */

    document.documentElement.classList.add("realm-ready");

    console.log(
        "✦ Orion Realm initialized successfully. Dream. Explore. Create."
    );

});
